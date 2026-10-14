// Node-API v8; all pathname authority is retained by native handles.
#ifndef _WIN32
#define _GNU_SOURCE
#endif
#include <node_api.h>
#include <uv.h>
#include <string>
#include <vector>
#include <cstdint>
#include <cerrno>
#include <cstddef>
#ifdef _WIN32
#include <windows.h>
#include <winternl.h>
#include <io.h>
#include <fcntl.h>
using String = std::wstring;
using NtCreate = NTSTATUS (NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
    PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using NtSet = NTSTATUS (NTAPI *)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, FILE_INFORMATION_CLASS);
struct RenameInfo { BOOLEAN replace; HANDLE root; ULONG length; WCHAR name[1]; };
static bool dispose(HANDLE file) {
  FILE_DISPOSITION_INFO_EX d{FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE};
  return SetFileInformationByHandle(file, FileDispositionInfoEx, &d, sizeof(d)) != 0;
}
#else
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#ifdef __linux__
#include <sys/vfs.h>
#include <linux/magic.h>
#endif
using String = std::string;
#endif
struct Lease {
  int fd = -1; bool output = false; bool committed = false; bool busy = false; double size = 0; String leaf;
#ifdef _WIN32
  std::vector<HANDLE> parents; HANDLE file = INVALID_HANDLE_VALUE;
#else
  std::vector<int> parents;
#endif
  ~Lease() { close(); }
  bool close() {
    bool ok = true;
#ifdef _WIN32
    if (fd >= 0) {
      if (output && !committed) {
        ok = dispose(file);
      }
      uv_fs_t request{};
      ok = uv_fs_close(nullptr, &request, fd, nullptr) == 0 && ok;
      uv_fs_req_cleanup(&request); fd = -1; file = INVALID_HANDLE_VALUE;
    }
    for (auto it = parents.rbegin(); it != parents.rend(); ++it) CloseHandle(*it);
#else
    if (fd >= 0) { ok = ::close(fd) == 0; fd = -1; }
    for (auto it = parents.rbegin(); it != parents.rend(); ++it) ::close(*it);
#endif
    parents.clear(); return ok;
  }
};
static napi_value error(napi_env env, const char* code) { napi_throw_error(env, code, code); return nullptr; }
#ifndef _WIN32
static const char* inputCode(int code) {
  return code == ENOENT ? "INPUT_NOT_FOUND" : code == EACCES || code == EPERM ? "INPUT_PERMISSION" : "UNSAFE_PATH";
}
#endif
static bool getString(napi_env env, napi_value arg, String& out) {
  napi_valuetype type; size_t n = 0;
  if (napi_typeof(env, arg, &type) != napi_ok || type != napi_string) return false;
#ifdef _WIN32
  if (napi_get_value_string_utf16(env, arg, nullptr, 0, &n) != napi_ok || n > 32760) return false;
  std::vector<char16_t> b(n + 1);
  if (napi_get_value_string_utf16(env, arg, b.data(), b.size(), &n) != napi_ok) return false;
  out.assign(b.begin(), b.begin() + n);
#else
  if (napi_get_value_string_utf8(env, arg, nullptr, 0, &n) != napi_ok || n > 32760) return false;
  std::vector<char> b(n + 1);
  if (napi_get_value_string_utf8(env, arg, b.data(), b.size(), &n) != napi_ok) return false;
  out.assign(b.data(), n);
#endif
  return !out.empty() && out.find(String::value_type(0)) == String::npos;
}
static bool component(const String& p) {
#ifdef _WIN32
  if (p.empty() || p == L"." || p == L".." || p.back() == L'.' || p.back() == L' ' || p.find_first_of(L"/:\\*?\"<>|") != String::npos) return false;
  String base = p.substr(0, p.find(L'.'));
  for (auto& c : base) if (c >= L'a' && c <= L'z') c -= L'a' - L'A';
  if (base == L"CON" || base == L"PRN" || base == L"AUX" || base == L"NUL" || base == L"CONIN$" || base == L"CONOUT$" || base == L"CLOCK$") return false;
  if (base.size() == 4 && (base.substr(0, 3) == L"COM" || base.substr(0, 3) == L"LPT") &&
      ((base[3] >= L'1' && base[3] <= L'9') || base[3] == 0xB9 || base[3] == 0xB2 || base[3] == 0xB3)) return false;
  return true;
#else
  return !p.empty() && p != "." && p != ".." && p.find('/') == String::npos;
#endif
}
// Optional internal audit hook. The CLI never supplies it; no environment/config
// or log content can enable it. Hooks run while the real authority is retained.
static bool hook(napi_env env, napi_value callback, const char* stage, const String& part) {
  if (!callback) return true;
  napi_value args[2], receiver, result;
  napi_create_string_utf8(env, stage, NAPI_AUTO_LENGTH, &args[0]);
#ifdef _WIN32
  napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(part.data()), part.size(), &args[1]);
#else
  napi_create_string_utf8(env, part.data(), part.size(), &args[1]);
#endif
  napi_get_undefined(env, &receiver);
  return napi_call_function(env, receiver, callback, 2, args, &result) == napi_ok;
}
static bool optionalHook(napi_env env, napi_value value) {
  napi_valuetype t; return napi_typeof(env, value, &t) == napi_ok && t == napi_function;
}
#ifdef _WIN32
static const char* winCode(NTSTATUS s, bool output) {
  if (output) return s == NTSTATUS(0xC0000035L) ? "OUTPUT_EXISTS" : "UNSAFE_OUTPUT";
  if (s == NTSTATUS(0xC0000034L) || s == NTSTATUS(0xC000003AL)) return "INPUT_NOT_FOUND";
  if (s == NTSTATUS(0xC0000022L)) return "INPUT_PERMISSION";
  return "UNSAFE_PATH";
}
static const char* child(HANDLE parent, const String& name, bool dir, bool output, HANDLE& h, bool any = false) {
  auto create = reinterpret_cast<NtCreate>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile"));
  if (!create) return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  UNICODE_STRING n{}; n.Buffer = const_cast<WCHAR*>(name.data());
  n.Length = static_cast<USHORT>(name.size() * sizeof(WCHAR)); n.MaximumLength = n.Length;
  OBJECT_ATTRIBUTES a{}; a.Length = sizeof(a); a.RootDirectory = parent; a.ObjectName = &n;
  a.Attributes = OBJ_CASE_INSENSITIVE | (any ? 0 : 0x1000); // OBJ_DONT_REPARSE; existence opens reparse leaf itself.
  IO_STATUS_BLOCK io{};
  NTSTATUS s = create(&h, (any ? 0 : dir ? FILE_TRAVERSE : output ? FILE_WRITE_DATA | DELETE : FILE_READ_DATA) | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    &a, &io, nullptr, FILE_ATTRIBUTE_NORMAL, output ? FILE_SHARE_READ : FILE_SHARE_READ | FILE_SHARE_WRITE, output ? 2 : 1,
    0x00200000 | 0x20 | (any ? 0 : dir ? 1 : 0x40), nullptr, 0); // reparse, synchronous, directory/non-directory
  if (s < 0) return winCode(s, output);
  FILE_ATTRIBUTE_TAG_INFO tag{};
  if (!GetFileInformationByHandleEx(h, FileAttributeTagInfo, &tag, sizeof(tag)) ||
      (!any && ((tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) || bool(tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != dir)) ||
      GetFileType(h) != FILE_TYPE_DISK) {
    if (output) dispose(h); // FILE_CREATE succeeded; cleanup must retain this exact owned object.
    CloseHandle(h); h = INVALID_HANDLE_VALUE; return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  }
  return nullptr;
}
#endif
static const char* openLease(napi_env env, napi_value audit, Lease& l, const String& full, const String& temporary) {
  const bool output = l.output; size_t pos;
#ifdef _WIN32
  if (full.size() < 4 || full[1] != L':' || full[2] != L'\\' ||
      !((full[0] >= L'A' && full[0] <= L'Z') || (full[0] >= L'a' && full[0] <= L'z'))) return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  HANDLE root = CreateFileW(full.substr(0, 3).c_str(), FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (root == INVALID_HANDLE_VALUE) return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  FILE_ATTRIBUTE_TAG_INFO tag{};
  if (!GetFileInformationByHandleEx(root, FileAttributeTagInfo, &tag, sizeof(tag)) || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    CloseHandle(root); return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  }
  l.parents.push_back(root); pos = 3; constexpr wchar_t separator = L'\\';
#else
  if (full[0] != '/') return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
#ifdef __linux__
  constexpr int directoryAccess = O_PATH;
#elif defined(O_SEARCH)
  constexpr int directoryAccess = O_SEARCH;
#else
  constexpr int directoryAccess = O_RDONLY;
#endif
  int root = ::open("/", directoryAccess | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (root < 0) return output ? "UNSAFE_OUTPUT" : inputCode(errno);
  l.parents.push_back(root); pos = 1; constexpr char separator = '/';
#endif
  while (pos < full.size()) {
    size_t end = full.find(separator, pos); bool last = end == String::npos;
    String p = full.substr(pos, (last ? full.size() : end) - pos);
    if (!component(p)) return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
    if (last) { l.leaf = p; break; }
    if (!hook(env, audit, "before-component", p)) return "INTERNAL_INVARIANT";
#ifdef _WIN32
    HANDLE next = INVALID_HANDLE_VALUE; const char* failure = child(l.parents.back(), p, true, false, next);
    if (failure) return output ? "UNSAFE_OUTPUT" : failure;
#else
    int next = openat(l.parents.back(), p.c_str(), directoryAccess | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0) return output ? "UNSAFE_OUTPUT" : inputCode(errno);
#endif
    l.parents.push_back(next); pos = end + 1;
    if (!hook(env, audit, "after-component", p)) return "INTERNAL_INVARIANT";
  }
  if (l.leaf.empty()) return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  if (!hook(env, audit, output ? "before-create" : "before-leaf", l.leaf)) return "INTERNAL_INVARIANT";
#ifdef _WIN32
  if (output) {
    HANDLE existing = INVALID_HANDLE_VALUE; const char* found = child(l.parents.back(), l.leaf, false, false, existing, true);
    if (!found) { CloseHandle(existing); return "OUTPUT_EXISTS"; }
    if (std::string(found) != "INPUT_NOT_FOUND") return "UNSAFE_OUTPUT";
  }
  HANDLE file = INVALID_HANDLE_VALUE; const char* failure = child(l.parents.back(), output ? temporary : l.leaf, false, output, file);
  if (failure) return output ? "UNSAFE_OUTPUT" : failure;
  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || uint64_t(size.QuadPart) > 9007199254740991ULL) {
    if (output) dispose(file);
    CloseHandle(file); return output ? "UNSAFE_OUTPUT" : "SOURCE_BYTE_LIMIT";
  }
  l.size = static_cast<double>(size.QuadPart);
  // Use Node/libuv's fd table, not a separate statically linked CRT table.
  l.fd = uv_open_osfhandle(file);
  if (l.fd < 0) {
    if (output) dispose(file);
    CloseHandle(file); return output ? "UNSAFE_OUTPUT" : "INPUT_READ";
  }
  l.file = file;
#else
  (void)temporary;
  if (output) {
#ifdef __linux__
    struct stat exists{};
    if (fstatat(l.parents.back(), l.leaf.c_str(), &exists, AT_SYMLINK_NOFOLLOW) == 0) return "OUTPUT_EXISTS";
    if (errno != ENOENT) return "UNSAFE_OUTPUT";
    l.fd = openat(l.parents.back(), ".", O_WRONLY | O_TMPFILE | O_CLOEXEC, 0600);
    if (l.fd < 0) return "UNSAFE_OUTPUT";
#else
    // No verified descriptor-only publication/cleanup backend on this platform.
    return "UNSAFE_OUTPUT";
#endif
  } else {
    l.fd = openat(l.parents.back(), l.leaf.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (l.fd < 0) return inputCode(errno);
  }
  struct stat status{};
  if (fstat(l.fd, &status) < 0 || !S_ISREG(status.st_mode)) return output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH";
  if (status.st_size < 0 || uint64_t(status.st_size) > 9007199254740991ULL) return "SOURCE_BYTE_LIMIT";
  l.size = static_cast<double>(status.st_size);
#endif
  if (!hook(env, audit, "after-open", l.leaf)) return "INTERNAL_INVARIANT";
  return nullptr;
}
static void finalize(napi_env, void* data, void*) { delete static_cast<Lease*>(data); }
static napi_value openCallback(napi_env env, napi_callback_info info) {
  napi_value args[3]; size_t count = 3; void* data = nullptr;
  napi_get_cb_info(env, info, &count, args, nullptr, &data);
  bool output = data != nullptr; String full, temporary;
  if (count < (output ? 2u : 1u) || !getString(env, args[0], full) ||
      (output && (!getString(env, args[1], temporary) || !component(temporary)))) return error(env, output ? "UNSAFE_OUTPUT" : "UNSAFE_PATH");
  napi_value audit = nullptr; size_t expected = output ? 2 : 1;
  if (count > expected) { audit = args[expected]; if (!optionalHook(env, audit)) return error(env, "INTERNAL_INVARIANT"); }
  auto l = new Lease(); l->output = output; const char* failure = openLease(env, audit, *l, full, temporary);
  if (failure) {
    delete l; bool pending = false; napi_is_exception_pending(env, &pending);
    return pending ? nullptr : error(env, failure);
  }
  napi_value object, fd, size, token;
  if (napi_create_object(env, &object) != napi_ok || napi_create_int32(env, l->fd, &fd) != napi_ok ||
      napi_create_double(env, l->size, &size) != napi_ok || napi_create_external(env, l, finalize, nullptr, &token) != napi_ok) {
    delete l; return error(env, "INTERNAL_INVARIANT");
  }
  napi_set_named_property(env, object, "fd", fd); napi_set_named_property(env, object, "size", size);
  napi_set_named_property(env, object, "token", token); return object;
}
static Lease* getLease(napi_env env, napi_callback_info info, napi_value& audit) {
  napi_value args[2]; size_t count = 2; void* l = nullptr;
  if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count < 1 ||
      napi_get_value_external(env, args[0], &l) != napi_ok) { error(env, "INTERNAL_INVARIANT"); return nullptr; }
  if (count > 1) { audit = args[1]; if (!optionalHook(env, audit)) { error(env, "INTERNAL_INVARIANT"); return nullptr; } }
  auto lease = static_cast<Lease*>(l);
  if (lease->busy) { error(env, "INTERNAL_INVARIANT"); return nullptr; }
  return lease;
}
static napi_value closeCallback(napi_env env, napi_callback_info info) {
  napi_value audit = nullptr; Lease* l = getLease(env, info, audit); if (!l) return nullptr;
  l->busy = true; bool ready = hook(env, audit, "before-discard", l->leaf); l->busy = false;
  if (!ready) return nullptr;
  if (!l->close()) return error(env, l->output ? "UNSAFE_OUTPUT" : "INPUT_READ");
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value commitCallback(napi_env env, napi_callback_info info) {
  napi_value audit = nullptr; Lease* l = getLease(env, info, audit); if (!l) return nullptr;
  if (!l->output || l->fd < 0 || l->committed) return error(env, "UNSAFE_OUTPUT");
  l->busy = true; bool ready = hook(env, audit, "before-publish", l->leaf); l->busy = false;
  if (!ready) return nullptr;
#ifdef _WIN32
  if (!FlushFileBuffers(l->file)) return error(env, "OUTPUT_WRITE");
  size_t bytes = offsetof(RenameInfo, name) + (l->leaf.size() + 1) * sizeof(WCHAR);
  std::vector<unsigned char> buffer(bytes, 0); auto rename = reinterpret_cast<RenameInfo*>(buffer.data());
  rename->replace = FALSE; rename->root = l->parents.back(); rename->length = static_cast<ULONG>(l->leaf.size() * sizeof(WCHAR));
  memcpy(rename->name, l->leaf.data(), rename->length);
  auto set = reinterpret_cast<NtSet>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtSetInformationFile"));
  if (!set) return error(env, "UNSAFE_OUTPUT");
  IO_STATUS_BLOCK io{}; NTSTATUS s = set(l->file, &io, rename, static_cast<ULONG>(bytes), static_cast<FILE_INFORMATION_CLASS>(10));
  if (s < 0) return error(env, winCode(s, true));
#elif defined(__linux__)
  if (fsync(l->fd) < 0) return error(env, "OUTPUT_WRITE");
  int result = linkat(l->fd, "", l->parents.back(), l->leaf.c_str(), AT_EMPTY_PATH);
  if (result < 0 && errno == ENOENT) {
    int proc = ::open("/proc/self/fd", O_RDONLY | O_DIRECTORY | O_CLOEXEC); struct statfs kind{};
    if (proc < 0 || fstatfs(proc, &kind) < 0 || kind.f_type != PROC_SUPER_MAGIC) {
      if (proc >= 0) ::close(proc); return error(env, "UNSAFE_OUTPUT");
    }
    std::string name = std::to_string(l->fd);
    result = linkat(proc, name.c_str(), l->parents.back(), l->leaf.c_str(), AT_SYMLINK_FOLLOW);
    int saved = errno; ::close(proc); errno = saved;
  }
  if (result < 0) return error(env, errno == EEXIST ? "OUTPUT_EXISTS" : "UNSAFE_OUTPUT");
#else
  return error(env, "UNSAFE_OUTPUT");
#endif
  l->committed = true; napi_value resultValue; napi_get_undefined(env, &resultValue); return resultValue;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor f[] = {
    {"openInput", nullptr, openCallback, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"createOutput", nullptr, openCallback, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(1)},
    {"commit", nullptr, commitCallback, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, closeCallback, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 4, f); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
