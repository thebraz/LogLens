# LogLens — auditoria adversarial da Stage 3

Atualização de 2026-10-14: este documento conserva o snapshot histórico da Stage 3.
A integração nativa e as evidências novas de LL-006/LL-008 estão na
[aceitação da Stage 4](STAGE_4_ACCEPTANCE.md). A Stage 4 foi autorizada e permanece
PARTIAL; os gates obrigatórios e a proibição de publicação não foram dispensados.

**Status: PARTIAL. Publicação bloqueada.** Autorização explícita recebida em 2026-10-13. A auditoria e as correções locais foram executadas sem depender do Daybreak. Stage 4, instalação de novos pacotes, empacotamento, publicação e escritas remotas não foram executados.

Existe uma violação reproduzida da política de caminhos: **LL-008**, leitura de arquivo não selecionado mediante troca de diretório ancestral. As verificações de identidade de temporários também não constituem confinamento atômico. Esses fatos não são promovidos a limitações aceitas para aprovar a etapa. A matriz de segurança de outros sistemas e os targets Ubuntu continuam NOT TESTED.

## Escopo, método e ambiente

Revisados os 13 contratos originais, todo `src/`, testes/fixtures, schema, build/lint/configuração, scripts de verificação, benchmarks e árvore/lockfile de dependências. Duas revisões independentes de segurança/arquitetura e uma investigação focada de I/O complementaram a revisão do agente principal. O código foi tratado como potencialmente defeituoso; fixtures sintéticas e oráculos explícitos foram usados antes das correções.

Não foram executados logs reais, serviços externos, credenciais encontradas ou código de outros históricos. A implementação de todas as dependências de desenvolvimento não recebeu auditoria linha a linha. Artefatos históricos e logs locais não foram tratados como fontes de verdade nem removidos. Nenhuma credencial ativa foi estabelecida; a proveniência de valores em artefatos manuais não pode ser inferida de seus nomes.

Windows x64, build **10.0.26200**, Node **24.19.0**, npm **11.17.0**, Intel **i7-1255U**, 12 CPUs lógicas, **16.890.978.304 bytes** de RAM. SSD não verificado. Ambiente desktop compartilhado, cache aquecido; fuzzing concorrente durante parte das medições. Não corresponde ao ambiente dedicado de referência. [Ambiente](../evidence/stage-3/environment.json).

Comandos usam `node` e `npm` como abreviação dos executáveis locais. A execução npm no harness usa `C:\Program Files\nodejs\node.exe` e `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`. O sandbox inicialmente impediu a inspeção dos ancestrais e das junctions; a mesma suíte foi reexecutada com acesso local autorizado, sem enfraquecer as verificações do produto. O resolver de SECURITY.md do plugin falhou com caminho Windows existente; a busca local não encontrou esse arquivo nos ancestrais/diretórios de código. `docs/SECURITY_MODEL.md` foi a política fornecida.

## Linha de base independente

| Verificação antes de mudar comportamento | Resultado real |
| --- | --- |
| `npm run check` dentro do sandbox | FAIL ambiental: 28 falhas, 149 PASS, 1 skip; INPUT_PERMISSION em verificações de ancestrais. [Log](../evidence/stage-3/baseline-check.log) |
| Mesma verificação com acesso local autorizado | PASS: **177 aprovados, 0 falhas, 1 skip POSIX**, 3 suítes. [Log](../evidence/stage-3/baseline-check-local.log) |
| `node node_modules/vitest/vitest.mjs run tests/stage3.test.ts` antes dos reparos | **7 FAIL, 4 PASS**; falhas efetivas de canários, timeout de scanner, estado multiline, temporário e gzip. [Log](../evidence/stage-3/regressions-before.log) |
| Experimento com ancestral substituído por junction real | **FAIL da política de segurança**, lendo somente arquivo sintético não selecionado. [Evidência](../evidence/stage-3/filesystem-race.json) |

A suíte anterior continha asserções úteis de conteúdo, contagens e efeitos, mas não cobria essas falhas. Passar nela não estabelecia segurança. Nenhuma expectativa foi modificada para aceitar comportamento incorreto. Houve timeouts intermediários de lotes de subprocessos sob carga concorrente; eles são diferenciados dos timeouts adversariais de scanner. O novo lote que executa dez subprocessos possui orçamento de 15 s; cada subprocesso mantém timeout de 5 s, e o teste específico do scanner mantém timeout de 2 s.

## Achados e correções

Distribuição: **0 críticos; 2 altos; 5 médios; 4 baixos**. **9 corrigidos, 1 mitigado parcialmente, 1 aberto**. Severidade descreve o impacto do defeito anterior, não uma garantia de ausência de outros defeitos.

### LL-001 — MÉDIO — Proteção incompleta de valores sensíveis compostos

- **Componente:** `src/output/protect.ts`, `src/output/project.ts`.
- **Reprodução/evidência:** busca com `--include-raw` em JSON contendo token array/objeto com vários valores. Attributes ficava protegido, mas raw expunha valores após vírgula/espaço. Chaves com escape JSON e spellings com muitos espaços também escapavam; fallback JSON malformado foi incluído na regressão. Canários sintéticos visíveis em regressions-before.
- **Causa:** scanner de atribuição terminava o valor no primeiro separador, não decodificava chaves raw e limitava a chave a 40 caracteres.
- **Correção:** scanner lexical de strings/chaves JSON e containers completos; tratamento limitado de escapes parciais; proteção do restante em container/aspas reconhecidas incompletas; suporte a spellings separados sem esse corte arbitrário. Proteção ocorre antes de clipping e inclui fallback/raw.
- **Regressão:** `protects entire sensitive JSON values…`, `redacts spaced sensitive keys…`, `keeps malformed JSON fallback…`; JSON/NDJSON e opt-out separados.
- **Verificação:** PASS nas regressões corrigidas; versão final registrada na matriz abaixo.
- **Risco residual:** detector de padrões não encontra segredos arbitrários/codificados/fragmentados ou toda PII; JSON desconhecido não recebe garantia universal de reconstrução. Raw é projeção protegida, não cópia byte a byte.

### LL-002 — MÉDIO — JWT com hífen nos limites permanecia visível

- **Componente:** `src/output/protect.ts`.
- **Reprodução/evidência:** `abcdefgh.ijklmnop.qrstuvw-` e `-abcdefg.ijklmnop.qrstuvwx`, todos os segmentos com pelo menos oito caracteres, permaneciam intactos.
- **Causa:** `\b` usa fronteiras de palavra incompatíveis com o alfabeto base64url.
- **Correção:** varredura de segmentos máximos, sem backtracking de sufixos; proteção conservadora de prefixos reconhecíveis em retenção incompleta.
- **Regressão:** endpoints `-`/`_`, segmentos mínimos e limites documentados; paridade texto/JSON/NDJSON/HTML/Markdown e opt-out com escapes ativos.
- **Verificação:** PASS. **Residual:** segmentos curtos completos e tokens fora do padrão continuam possíveis misses documentados.

### LL-003 — ALTO — Consumo quadrático de CPU no scanner de credenciais

- **Componente:** `src/output/protect.ts`; consumidor `project` antes do clipping.
- **Reprodução/evidência:** `http://` seguido de colons sem `@`; o subprocesso com 65.536 caracteres excedeu **2 s** e foi encerrado pelo teste. Retenção raw podia alimentar o scanner com muito mais bytes do que a projeção final.
- **Causa:** classes ilimitadas sobrepostas na regex de userinfo; falhas de candidatos JWT também permitiam revarrer sufixos. Trabalho síncrono atrasava o atendimento de interrupções.
- **Correção:** scanners de tokens máximos/autoridade, valores consumidos uma vez e união de spans. Sem nova dependência/regex fornecida pelo usuário.
- **Regressão:** subprocesso limitado a 2 s com URI/JWT negativos de 64 KiB; canários e idempotência da política preservados.
- **Verificação:** PASS. Uma observação posterior de URI negativa de **1 MiB: 72,88 ms**, sem alegar mediana ou benchmark universal. [Medições](../evidence/stage-3/scanner-after.jsonl).
- **Residual:** CPU ainda cresce com o volume de dados; limites/RSS e latência de sinais em outras plataformas precisam de execução real.

### LL-004 — MÉDIO — Rejeição de gzip podia ficar presa ao produtor aberto

- **Componente:** `src/io/input.ts`.
- **Reprodução/evidência:** stdin fornece cabeçalho gzip inválido e mantém o pipe aberto. A operação não terminava antes do abort externo, embora o gzip já estivesse rejeitado.
- **Causa:** cleanup aguardava pipeline/retorno do iterador que ainda aguardava stdin; apenas o sinal externo destruía esse leitor.
- **Correção:** cancelamento pertencente à operação de entrada, acionado antes de aguardar cleanup; preservação do código original de gzip/limite.
- **Regressão:** Readable pendente e subprocesso CLI com produtor aberto, fonte posterior válida e GZIP_INVALID explícito.
- **Verificação:** PASS; fonte posterior é processada, resultado parcial/3, sem hang. **Residual:** filesystem remoto travado está fora da promessa local de latência.

### LL-005 — BAIXO — Estado de exceção atravessava fronteiras

- **Componente:** `src/core/records.ts`.
- **Reprodução/evidência:** exceção → blank ou JSON → `ValueError: separate`; o evento independente recebia ORPHAN_CONTINUATION e cobertura parcial incorreta.
- **Causa:** `marked` sobrevivia ao flush quando `pending` era limpo.
- **Correção:** reset desse estado no mesmo flush.
- **Regressão:** duas fronteiras, dano/diagnóstico e linha física exatos. **Verificação:** PASS. **Residual:** somente as gramáticas multiline documentadas são reconhecidas.

### LL-006 — BAIXO — Commit/cleanup confiavam apenas no nome temporário

- **Componente:** `src/io/sink.ts`.
- **Reprodução/evidência:** mover o temp pertencente ao CLI e criar arquivo substituto com o mesmo nome fazia commit publicar o substituto; discard podia remover uma entrada desconhecida.
- **Causa:** escrita pelo descriptor, seguida de link/unlink por pathname sem identidade.
- **Correção parcial:** comparar identidade/tipo do temp e pai, manter descriptor aberto durante link, verificar arquivo publicado, preservar substitutos detectados. Não há overwrite de destino preexistente.
- **Regressão:** substituição real do temp antes do commit; rejeição UNSAFE_OUTPUT, nenhum destino e substituto preservado.
- **Verificação:** PASS para essa substituição; **PARTIAL para resistência atômica**. Checks e link/unlink continuam separados. Uma falha ao obter identidade prioriza fechar descriptor e preservar conteúdo desconhecido, podendo exigir limpeza manual.
- **Risco residual:** não foi estabelecido privilégio adicional somente pela falsificação de relatório em diretório já substituível pelo atacante. Isso não resolve a violação de propriedade/atomicidade exigida pelo contrato.

### LL-007 — BAIXO — Admissão não reservava crescimento dos escalares

- **Componente:** `src/core/analysis.ts`.
- **Condição/evidência:** admissão contabilizava count=0 e bounds=null; updates posteriores aumentavam a serialização além da carga inicialmente contabilizada.
- **Causa:** estimativa inicial não incluía o crescimento máximo dos sete contadores de timeline ou dos bounds.
- **Correção:** reserva adicional de 128 bytes por entrada, cobrindo os escalares até seus limites seguros; limites globais/por chave permanecem.
- **Regressão:** entrada inicialmente sem tempo seguida de 100 membros com tempo; contagem=101 e tamanho real serializado+512 permanece dentro da reserva constante.
- **Verificação:** PASS. **Residual:** contabilização de estado não equivale ao RSS total de Node/GC/zlib; RSS é medido separadamente.

### LL-008 — MÉDIO — Troca de ancestral pode abrir arquivo não selecionado — ABERTO

- **Componente:** `src/io/paths.ts:31-37`.
- **Condição:** ator controla um ancestral mutável do caminho selecionado, pode trocá-lo por junction/symlink e restaurá-lo entre verificações. Não pressupõe administrador ou conta do operador comprometida.
- **Evidência:** `node scripts/audit-filesystem-race.mjs`: junction real, arquivos sintéticos, troca após component check e restauração após open. O descriptor leu o arquivo sintético não selecionado. [Resultado FAIL](../evidence/stage-3/filesystem-race.json).
- **Causa:** O_NOFOLLOW protege a folha onde disponível; lstat/open podem resolver o mesmo destino redirecionado e passar o teste dev/ino. O recheck do pathname restaurado não vincula os ancestrais ao descriptor aberto.
- **Remediação necessária:** operações de travessia/abertura/commit relativas a descriptors, com garantias equivalentes em cada plataforma, ou política fail-closed deliberada para caminhos cuja autoridade não pode ser protegida. As APIs Node portáveis usadas aqui não fornecem essa vinculação atômica completa. Repetir checks não é reparo definitivo.
- **Regressão/evidência retida:** experimento reproduzível com fault injection coordenando chamadas reais; ele registra FAIL da propriedade, não transforma o ataque em teste positivo de segurança.
- **Verificação:** **FAIL / NÃO CORRIGIDO**. A sincronização foi cooperativa em um processo, não corrida multiprincipal espontânea; probabilidade/timing/ACLs de um ataque real não foram medidos. Não foi lido arquivo real do usuário.
- **Risco/bloqueador:** possível exposição de conteúdo local acessível ao operador sob label de fonte selecionada. Bloqueia saída da Stage 3 e release mesmo sem exploit remoto ou certificação.

### LL-009 — MÉDIO — Cabeçalho gzip sem saída evitava limites decodificados

- **Componente:** `src/io/input.ts`, `src/cli/run.ts`; contrato PERFORMANCE_SPEC, decisão D18.
- **Condição/evidência:** FNAME gzip sem terminador pode consumir bytes comprimidos sem emitir bytes decodificados; contador somente decodificado não o limita.
- **Causa:** ratio/bytes de saída não cobrem esse estado do descompressor.
- **Correção:** caps independentes de **10 GiB comprimidos/fonte** e **50 GiB comprimidos entre fontes gzip/run**, com SOURCE_BYTE_LIMIT/RUN_BYTE_LIMIT existentes. `stats.bytesRead` continua decodificado, sem eventos ou offsets fabricados.
- **Regressão:** cabeçalho sem EOF, cap injetado de 64 bytes e progresso do run no limite; rejeição e destruição do stdin, contabilidade comprimida exata.
- **Verificação:** PASS da lógica e cleanup. **Residual:** não executados cabeçalhos físicos de 10/50 GiB; o teste de 5 GiB é leitura JSONL, não esse gate.

### LL-010 — BAIXO — Colisão de chaves protegidas eliminava metadados

- **Componente:** `protectJson` em `src/output/protect.ts`.
- **Condição/evidência estática:** chaves diferentes como `token=A`/`token=B` viravam a mesma chave protegida; defineProperty substituía o valor anterior. Não foi registrada execução do binário anterior para este caso.
- **Causa:** ausência de disambiguação após transformar chaves, apesar da preservação obrigatória da estrutura não sensível.
- **Correção:** sufixos determinísticos a partir de `:2`, verificando colisões também com chaves já existentes. Valores e análise original são preservados.
- **Regressão:** três chaves que colidem, com valores independentes 1/2/3, incluindo colisão com um sufixo previamente presente.
- **Verificação:** PASS na regressão da versão final. **Residual:** nomes protegidos são projeções, não os originais; changed continua explícito.

### LL-011 — ALTO — Expansão HTML e prefixos elevavam o RSS acima do gate

- **Componentes:** `src/output/render.ts`, `src/core/json.ts`.
- **Reprodução/evidência:** 1200 erros distintos, mensagens com 15000 `&`, input de **18042090 bytes**. O HTML finalmente rejeitava OUTPUT_LIMIT/4 e limpava o temp, mas o processo já atingira **747,75 MiB RSS**, acima de 512 MiB. [Falha preservada](../evidence/stage-3/resource-stress-before.json), [log](../evidence/stage-3/resource-stress-before.log).
- **Causa:** expansão completa por replace callback antes da checagem de tamanho; prefixos construídos caractere a caractere geravam ropes/retinham buffers desproporcionais à projeção contabilizada.
- **Correção:** calcular exatamente o tamanho HTML escapado antes da expansão, escapar em blocos limitados e copiar prefixos uma vez em limites UTF-8, preservando unidades UTF-16/surrogates. Sem alterar limites ou bytes de relatórios válidos.
- **Regressão:** limite exato/+1 byte, caracteres especiais e emoji atravessando blocos, prefixos UTF-8/surrogate; repetição do mesmo workload real com gate de RSS **inalterado em 512 MiB**.
- **Verificação:** PASS no mesmo input/hash, com **233,22 MiB RSS** na repetição final da rejeição. Um HTML grande válido abaixo do cap também passou, com **478,25 MiB RSS**; essa proximidade ao gate fica explícita. [Resultados finais](../evidence/stage-3/resource-stress.json). **Residual:** RSS inclui GC/runtime, e a matriz de desempenho de referência continua não executada; não há promessa de memória constante universal.

## Resultados e critérios executados

Evidências abaixo correspondem a processos concluídos. NOT TESTED não significa PASS. Identidade final e verificação de links/hashes: [manifesto](../evidence/stage-3/build-manifest.json), [digest](../evidence/stage-3/build-manifest.sha256), [verificação](../evidence/stage-3/artifact-verification.json).

Build final: **2511c1c6bc33bd8003bbc2ead984f2dcce7328c91a3ca430b4520085eb7af631**, **81 arquivos** conferidos e **162 referências locais** verificadas. O relatório/evidências são excluídos do manifesto para evitar autorreferência; fonte, build, contratos, testes, scripts, fixtures e configuração estão incluídos.

| Gate | Comando / evidência | Status |
| --- | --- | --- |
| Types/lint/build/regressões finais | `npm run check`; **4 suítes, 195 PASS, 0 FAIL, 1 skip, 196 coletados**, 19,20 s; [log final](../evidence/stage-3/final-check.log) | PASS |
| Regressões adicionadas | **18 testes**, incluindo fault injection e CLI real; [log focado final](../evidence/stage-3/focused-final.log) | PASS |
| Schemas e workflows reais | `node scripts/verify-stage2.mjs stage-3`; **16 verificações** no build final, contagens e JSON Schema; [resultados](../evidence/stage-3/cli-checks.json) | PASS |
| JSONL fuzz | `node scripts/fuzz-stage3.mjs jsonl 30`; **774336 registros, 1800,027 s, RSS 207,43 MiB** | PASS |
| Texto/multiline fuzz | `node scripts/fuzz-stage3.mjs text 30`; **1023968 registros, 1800,071 s, RSS 203,78 MiB** | PASS |
| Replay após últimos reparos | `node scripts/fuzz-stage3.mjs jsonl 0.001 3125 -final-replay`, equivalente text; **100000 registros/família**, hashes/asserções; [JSONL](../evidence/stage-3/fuzz-jsonl-final-replay.json), [texto](../evidence/stage-3/fuzz-text-final-replay.json) | PASS |
| Permissões NTFS e shell reais | `./scripts/audit-windows.ps1`; negar ReadData/CreateFiles e restaurar ACLs; Unicode stdin e stdout redirecionado com LF em **PowerShell 7.6.5**; [3 checks](../evidence/stage-3/windows-acl.json) | PASS |
| Gzip/UTF-8/JSON/linha/evento/metadata/prototype/stream errors | testes anteriores + `tests/stage3.test.ts`; limites, recuperação, canários e posições | PASS |
| Dataset 5 GiB por stdin no build final | `node benchmarks/large.mjs stage-3 large-stream-final`; **5242880 eventos / 5368709120 bytes**, **318,709 s**, CLI RSS **175,50 MiB**, driver **48,14 MiB**; [evidência](../evidence/stage-3/large-stream-final.json) | PASS |
| Série Windows ~1 GiB e 100000 grupos | `node benchmarks/run.mjs 1024 100000 stage-3`; **36 subprocessos**, warm-up + cinco runs/workload, hashes estáveis e oráculos exatos | PASS local; não é referência nem snapshot final único |
| Série final sem outros workloads desta auditoria | `node benchmarks/run.mjs 16 100000 stage-3 benchmarks-final-isolated.json`; **36 subprocessos**, cinco runs medidos/workload; [evidência](../evidence/stage-3/benchmarks-final-isolated.json) | PASS local |
| IDs/buckets/contexto/HTML ampliado | `node scripts/stress-stage3.mjs`; 10000 keys retidas, overflow=1 para IDs/buckets; 10002 matches/1 emitido/0 contexto; HTML válido e over-limit; RSS **173,26/55,24/478,25/233,22 MiB** | PASS |
| Dependências | `npm audit --json --ignore-scripts`; **0 avisos conhecidos** na consulta; `npm ls --all --json` | PASS da consulta, não garantia de ausência de vulnerabilidades |
| Ancestor race | `node scripts/audit-filesystem-race.mjs` | **FAIL — LL-008** |
| Native Windows Ctrl+C; demais reparse/ACL/races | delivery real e garantias completas não disponíveis nesta execução | NOT TESTED |
| Linux/macOS: sinais, no-follow, modos, filesystem | sem execução nesses sistemas | NOT TESTED |
| Ubuntu dedicado: targets/repetições de referência | ambiente exigido não disponível; nenhuma meta alterada | NOT TESTED |
| Tarball/shims/matriz de instalação/CI/publicação | Stage 4 ou publicação, fora da autorização | NOT TESTED / NOT AUTHORIZED |

Fuzz valida partições aleatórias reproduzíveis, contagem independente, byte/hash/linha, ordinais, severidades, conservação de timeline/grupos, fingerprint estável, serialização, ausência de poluição de protótipo e canários em projeções raw/estruturadas. Cada batch retém somente 32 eventos; não há dataset inteiro em memória/disco. Seeds, estados finais, batches e hashes estão em [JSONL](../evidence/stage-3/fuzz-jsonl.json) e [texto](../evidence/stage-3/fuzz-text.json). Para repetir exatamente o número salvo de batches, o quarto argumento de fuzz-stage3 aceita esse número; tempo sozinho não fixa quantidade. Os runs longos cobrem o parser já corrigido; após os ajustes finais de consumidores/proteção/caps/contabilidade foram executados replay de 100000 registros/família, regressões finais e stress dirigido, sem reivindicar novo run de 30 minutos desses consumidores.

## Observações de desempenho

[Série ~1 GiB](../evidence/stage-3/benchmarks.json), [runs brutos](../evidence/stage-3/benchmark-runs.log), [5 GiB final](../evidence/stage-3/large-stream-final.json), [série final de 16 MiB](../evidence/stage-3/benchmarks-final-isolated.json) e [stress](../evidence/stage-3/resource-stress.json). Datasets sintéticos determinísticos, hashes e contagens são verificados contra o gerador, não apenas exit status. RSS é o pico OS via Node/libuv resourceUsage.maxRSS; o wrapper de medição não é heapUsed. O CLI não cria subprocessos; geradores/drivers são medição externa e possuem memória separada.

| Workload | Série ~1 GiB: mediana MiB/s / maior RSS MiB | Série final 16 MiB: mediana MiB/s / maior RSS MiB |
| --- | --- | --- |
| inspect JSONL | 22,42 / 169,38 | 30,31 / 58,47 |
| group texto multiline | 15,98 / 173,38 | 28,46 / 61,88 |
| report texto multiline | 11,41 / 117,91 | 28,04 / 61,25 |
| inspect gzip | 10,89 / 177,46 | 27,04 / 62,80 |
| search JSONL | 12,17 / 171,30 | 25,67 / 59,54 |
| 100000 grupos distintos, 97,65625 MiB | 5,70 / 137,40 | 23,17 / 141,44 |

O workload de cardinalidade admite exatamente **10000** grupos e contabiliza **90000** eventos de overflow, com parcial/3 em todos os runs. A série ~1 GiB contém **1048576 registros JSONL / 1073741824 bytes**, texto com **1115607 eventos / 1073741858 bytes**, 10% multiline, e gzip normal com ratio registrado no JSON. A verificação final de 5 GiB produziu o mesmo hash de resultado das verificações anteriores: **b6cf487bcfd75bdd3a9eef943a68d80b5c7ff5c2e8bdb3014c84c42289ea7dd8**.

Os runs ~1 GiB começaram após as correções principais de scanners/framing/gzip, e durante a série foram acrescentadas reservas/caps/proteção de fallback. A série não é apresentada como benchmark de um único snapshot final nem como comparação limpa com Stage 2. Uma [série final concorrente](../evidence/stage-3/benchmarks-final-smoke.json) também foi preservada; depois, a série final de 16 MiB foi repetida sem outros workloads desta auditoria, resultando nos valores acima. O desktop continua compartilhado; ausência de competição externa não foi estabelecida. Nenhuma mediana local aprova ou reprova os targets Ubuntu. A leitura final de 5 GiB é um único run de correção/memória sob concorrência, com vazão **16,06 MiB/s**, não mediana de referência.

## Limitações e decisão de saída

- **Bloqueadores atuais:** LL-008, confinamento atômico de temp/link/unlink/ancestrais, tipos Windows reparse não verificados, entrega nativa de sinais e matriz de segurança Linux/macOS, desempenho dedicado Ubuntu ainda não executado. Stage 2 continua PARTIAL; trabalho de hardening não oculta essa dependência.
- **Limitações preservadas:** detector de padrões não é proteção universal de PII/segredos; fingerprints revelam igualdade e permitem guessing de templates de baixa entropia; formatos multiline/encodings desconhecidos, sobrescrita de mesmo tamanho, persistência de stdout e resíduos de crash. Saturação reporta ranking entre grupos admitidos e overflow exato, sem aproximação disfarçada.
- **Escopo da evidência:** canários provam os padrões e caminhos exercitados; fuzzing finito não certifica segurança. Fault injection estabelece o defeito de controle de caminhos, mas não mede exploit multiprincipal. Consulta npm é um snapshot de advisories, não auditoria integral de fornecedores.
- **Release:** não pronto. Licença/identidade npm, Stage 4/tarball/CI e autorização de publicação permanecem decisões/gates separados, sem identidades inventadas.

**Stage 3: PARTIAL.** As correções e evidências locais são entregáveis; os critérios de saída não foram enfraquecidos para aprovar a etapa.

## Registro complementar de segurança

O [relatório gerado do plugin](C:/Users/jbraz/.codex/state/plugins/codex-security/scans/LogLens/unversioned_20261013T215006Z_x6q2rj7n/report.md) foi finalizado/indexado com o achado atual LL-008. Seu identificador conserva o snapshot inicial da análise, pois o diretório mudou durante as correções autorizadas; ele não substitui o manifesto final e a evidência pós-reparo deste documento. O controle de raiz em paths.ts permaneceu inalterado e foi validado no código atual. Não foi criado outro scan para ocultar esse fato.

Uso reportado pelo host para o scan e seus quatro chats, cobertura completa: **20558706 tokens totais**, **20420556 de entrada**, dos quais **19829248 em cache**; **138150 de saída**. São metadados de uso da auditoria, não métricas do CLI, custo ou certificação.
