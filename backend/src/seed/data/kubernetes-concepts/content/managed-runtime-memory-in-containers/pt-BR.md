---
version: 1.0
updatedAt: 2026-09-26
title: "Memória de Runtimes Gerenciados em Containers"
summary: "Como JVM, Node.js, .NET e Go dimensionam o heap sob um limit de container, o que fica fora do heap, e uma regra de dimensionamento que evita OOMKilled."
---
## Objective

Um limit de memória de container cobre o **processo inteiro**, não só o heap. Runtimes com gerenciamento de memória próprio (a JVM, o Node.js, o .NET, o Go) dimensionam o heap a partir do que acham que está disponível, e cada um lê o limit do container de um jeito diferente, ou nem lê. Errar para um lado e o kernel faz `OOMKill` no container sem nenhum erro de falta de memória nos logs; errar para o outro e o runtime usa uma fração da memória pela qual você paga, ou lança um erro de falta de memória com o container longe do limit. Este conceito cobre como runtimes comuns se dimensionam dentro de um container, o que vive fora do heap, e uma regra de dimensionamento que funciona.

## Use Cases

- Um serviço reiniciando com exit code 137 (`OOMKilled`) enquanto as métricas de heap pareciam normais.
- Um serviço com limit de 2 Gi que fica sem heap em 512 MiB.
- Escolher a configuração de heap e o limit de memória de um serviço novo.
- Entender por que a mesma imagem se comporta diferente no laptop e no cluster.

## Deep Dive

### Cada runtime lê o limit de um jeito

Medido com `docker run --memory=<limit>`, que define o mesmo limit de cgroup que o Kubernetes define para `resources.limits.memory`:

| Runtime | Teto padrão de heap sob um limit | Medido |
|---|---|---|
| JVM (Temurin 25) | 25% do limit (`MaxRAMPercentage=25`) | limit 1 GiB: heap máximo 256 MiB; 2 GiB: 512 MiB |
| Node.js 22 | cerca de 50% do limit | 512 MiB: 259 MiB; 1 GiB: 524 MiB; 2 GiB: 1048 MiB |
| .NET | hard limit do GC em 75% do limit | padrão documentado |
| Go | **nenhum** limite de heap derivado do cgroup; defina `GOMEMLIMIT` | padrão documentado |

Sem limit, cada runtime se dimensiona pela máquina que enxerga. Verificado: a mesma imagem Node.js sem limit numa VM Docker de 8 GiB reportou um teto de heap de 2096 MiB, muito além do que o scheduler reservou para o Pod pelo request.

O padrão de 25% da JVM é conservador de propósito (foi pensado para máquinas compartilhadas), e é o motivo do "acabou o heap enquanto o container ainda tem muita memória".

### Para onde vai o resto da memória

O heap é só uma parte do processo. O que costuma viver fora dele:

| Área | Exemplos |
|---|---|
| Metadados do runtime | metaspace e code cache da JVM, code space do V8 |
| Stacks de threads | cerca de 1 MiB reservado por thread de plataforma na JVM |
| Buffers fora do heap | buffers diretos/nativos usados por bibliotecas de rede |
| Bibliotecas nativas e arenas do alocador | dezenas de MiB, às vezes crescendo (fragmentação do glibc) |
| Controle do GC | alguns % do heap |

Para um serviço web típico na JVM essa parte fora do heap fica entre 150 e 400 MiB, e não encolhe junto com o heap. É por isso que a porcentagem certa de heap depende do tamanho do container: 75% de 4 GiB deixa 1 GiB para o resto, 75% de 512 MiB deixa só 128 MiB.

### Limits também mudam o comportamento do runtime

A JVM também lê o limit de CPU e, junto com o de memória, decide qual garbage collector usar. Ela só escolhe o G1 numa máquina "server class" (pelo menos 2 processadores e cerca de 1792 MiB). Medido com Temurin 25 e 2 CPUs:

| Limits do container | GC escolhido |
|---|---|
| memória 1 GiB, cpu 2 | Serial |
| memória 2 GiB, cpu 2 | G1 |

O Serial GC para a aplicação inteira a cada coleta, o que aparece como picos de latência. Containers pequenos devem escolher o coletor explicitamente. Efeitos parecidos existem em outros lugares: o tamanho de pools de threads segue o número de CPUs detectado em muitos runtimes, e o Go desde a 1.25 dimensiona o `GOMAXPROCS` a partir do limit de CPU.

### Uma regra de dimensionamento

```
limit do container = teto do heap + fora do heap + margem de segurança
```

Defina o teto do heap **relativo ao limit**, para que mudar o limit redimensione o heap:

```yaml
resources:
  requests: {memory: 1Gi}
  limits:   {memory: 1Gi}
env:
  - name: JAVA_TOOL_OPTIONS            # JVM: lida por todo processo java do container
    value: "-XX:MaxRAMPercentage=65 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError"
  # Node.js:  NODE_OPTIONS="--max-old-space-size=640"   (MiB, absoluto)
  # Go:       GOMEMLIMIT=800MiB                          (limite suave para o GC)
```

- 60 a 75% para o heap é a faixa usual; menos em containers pequenos.
- Faça um out-of-memory de heap **encerrar o processo** (`-XX:+ExitOnOutOfMemoryError` na JVM) para o Kubernetes reiniciá-lo, em vez de deixar um processo meio quebrado rodando.
- Mantenha request igual ao limit para memória: o runtime vai acabar crescendo o heap até o teto, então o uso "ocioso" logo depois da inicialização não é o consumo real.

### Medir em vez de chutar

```bash
kubectl top pods -n team-a --containers
```

e o pico de working set em uma semana no Prometheus:

```
max_over_time(container_memory_working_set_bytes{namespace="team-a", container="app"}[7d])
```

Compare com o teto do heap. Se o working set continua crescendo enquanto o heap está estável, o crescimento é memória nativa: use as ferramentas do próprio runtime (Native Memory Tracking da JVM com `jcmd <pid> VM.native_memory summary`, heap snapshots do V8) via `kubectl exec`. Meça de novo depois de atualizar o runtime ou dependências grandes.

## Trade-offs

- **Heap maior vs mais folga nativa.** Mais heap significa menos GCs e mais espaço para caches; menos folga significa OOM kills em picos de memória nativa.
- **Configuração de heap em porcentagem vs absoluta.** Uma porcentagem acompanha o limit automaticamente; um valor absoluto (`-Xmx`, `--max-old-space-size`) é explícito e diverge em silêncio quando alguém muda só o limit.
- **Padrões do runtime vs flags explícitas.** Os padrões mudam entre versões do runtime e tamanhos de container (escolha do GC, número de threads); configurações explícitas tornam o comportamento previsível ao custo de mais uma coisa para manter.

## Documentation Links

- [Kubernetes docs: Assign Memory Resources to Containers](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/): limits e comportamento de OOM.
- [Java SE docs: the java command](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html): `MaxRAMPercentage`, `ActiveProcessorCount`, `ExitOnOutOfMemoryError`.
- [Node.js docs: --max-old-space-size](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib): opção de tamanho do heap do V8.
- [.NET docs: GC heap hard limit](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector#heap-hard-limit): padrões em containers.
- [Go docs: A Guide to the Go Garbage Collector (memory limit)](https://go.dev/doc/gc-guide#Memory_limit): `GOMEMLIMIT`.
