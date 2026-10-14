
{
  "targets": [
    {
      "target_name": "loglens_fs",
      "defines": ["NAPI_VERSION=8"],
      "msvs_settings": {
        "VCCLCompilerTool": {"DebugInformationFormat": 0},
        "VCLinkerTool": {"GenerateDebugInformation": "false"}
      },
      "sources": [
        "native/filesystem.cc"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "defines": [
              "WIN32_LEAN_AND_MEAN",
              "NOMINMAX"
            ]
          }
        ]
      ]
    }
  ]
}
