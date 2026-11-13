---
version: 1.1
updatedAt: 2026-11-13
title: "GOMAXPROCS em Contêineres"
summary: O GOMAXPROCS ciente de contêiner do Go 1.25, separando o que foi medido no macOS com Go 1.27 do que vem da doc e do código do runtime; a regra (mínimo entre CPUs, afinidade e o teto arredondado para cima do limite do cgroup, piso de 2, request ignorado), os arquivos cpu.max e de quota do cfs lidos só do cgroup folha, as atualizações periódicas pelo sysmon e pela goroutine GOMAXPROCS updater, as sobrescritas e o SetDefaultGOMAXPROCS com suas pausas stop-the-world, a linha go do go.mod desligando tudo (e um bloco godebug religando), um contador do godebug que nunca se mexe, e uma carga CPU-bound em malha aberta mostrando vazão travada e segundos de latência abaixo do paralelismo necessário, com o throttling deixado para a documentação.
---
## Objective

Do Go 1.5 ao 1.24, o `GOMAXPROCS` padrão era o número de núcleos da máquina, então um
pod limitado a 2 CPUs num nó de 64 núcleos rodava 64 Ps. O Go 1.25 tornou o padrão
ciente de contêiner no Linux e acrescentou atualizações periódicas em todo SO. Esta
lição separa o que foi medido do que vem da documentação. Medido com Go 1.27.0
(`GOTOOLCHAIN=go1.27.0`, linha `go 1.27` no módulo salvo indicação) num Apple M4 Max (14
núcleos, arm64), macOS 27.0.1, 3 execuções por programa: o padrão e suas sobrescritas,
`runtime.SetDefaultGOMAXPROCS`, a goroutine do runtime que aplica as atualizações, como
a linha `go` do `go.mod` desliga tudo isso, e uma carga CPU-bound em malha aberta com
`GOMAXPROCS` de 1 a 56. Não medido, porque o macOS não tem cgroups e não havia Docker:
a leitura do `cpu.max`, request versus limit no Kubernetes, arredondamento e throttling.
Isso vem das notas do Go 1.25, do blog do Go, da doc de `runtime` e do código da 1.27,
e está atribuído no texto.

## Use Cases

- Remover `go.uber.org/automaxprocs` ou um `GOMAXPROCS` fixado na mão depois de migrar para Go 1.25+.
- Pods com CPU request e sem limit: entender por que o `GOMAXPROCS` continua igual aos núcleos do nó.
- Redimensionamento in-place do pod ou um VPA mudando o limite de CPU com o processo rodando.
- Explicar picos de p99 causados por throttling em pods com limite muito abaixo do tamanho do nó.
- Toolchain nova com `go 1.24` ainda no `go.mod`: por que nada mudou.

## Deep Dive

### A regra, como documentada

A doc de `runtime.GOMAXPROCS` na 1.27: se a variável de ambiente `GOMAXPROCS` for um
número positivo, ela vence. Senão o padrão é o mínimo entre o número de CPUs lógicas, a
máscara de afinidade de CPU e, no Linux, o "average CPU throughput limit" do cgroup
(quota/period), "never ... less than 2 unless the logical CPU count or CPU affinity
mask count are below 2", e um limite fracionário "rounds up to the next whole number".
O código (`runtime/cgroup_linux.go`, 1.27) é curto:

```go
func adjustCgroupGOMAXPROCS(procs int32, cpu cgroup.CPU) int32 {
	limit, ok, err := cgroup.ReadCPULimit(cpu)
	if err == nil && ok {
		limit = ceil(limit)
		limit = max(limit, 2)
		if int32(limit) < procs {
			procs = int32(limit)
		}
	}
	return procs
}
```

Aplicando a regra à mão (aritmética, não medição): limite `2500m` num nó de 64 núcleos
dá 3; limite `500m` dá 2; limite `4` dá 4; um request de `2` sem limite dá 64. As notas
do Go 1.25: "The Go runtime does not consider the 'CPU requests' option."

### O que o runtime lê

Pelo código e pela doc da 1.27 (não medido aqui):

- cgroup v2: `cpu.max`, formato `$MAX $PERIOD` em microssegundos, onde `max` significa sem
  limite (doc do kernel; o padrão é "max 100000"). cgroup v1: `cpu.cfs_quota_us` (`-1`
  significa sem limite) e `cpu.cfs_period_us`.
- Na partida o runtime lê `/proc/self/cgroup` e `/proc/self/mountinfo`, abre os arquivos
  de limite e os mantém abertos "for the entire process lifetime", relendo com `pread` a
  partir do offset 0. As notas do Go 1.25 mencionam os descritores em cache.
- Duas lacunas documentadas no comentário do código: só o cgroup folha é lido, então um
  limite mais apertado no pai passa despercebido ("container runtimes tend to hide parent
  cgroups ... anyway"), e um processo migrado para outro cgroup "will not notice".
- No Kubernetes, o limit "defines a hard ceiling on how much CPU time the container can
  use" por intervalo de escalonamento, enquanto "the CPU request typically defines a
  weighting" (doc do Kubernetes). A doc de `runtime`: quota/period "usually corresponds
  to the 'CPU limit' option, not 'CPU request'".

### Atualizações periódicas: sysmon e a goroutine updater

Na 1.27 o `sysmon` chama `sysmonUpdateGOMAXPROCS` "at most once per second",
recalculando o padrão (no macOS só o número de CPUs, conforme `cgroup_stubs.go`). Se o
valor mudou, ele acorda uma goroutine do runtime que para o mundo e o aplica. Essa
goroutine aparece no `GODEBUG=schedtrace=10,scheddetail=1`:

```text
  G17: status=4(GOMAXPROCS updater (idle)) m=nil lockedm=nil
```

Ela apareceu em 3 de 3 execuções, inclusive com `GOMAXPROCS=4` no ambiente (fica
ociosa: o código pula as atualizações quando `sched.customGOMAXPROCS` está ligado). Com
`GODEBUG=updatemaxprocs=0` ela não apareceu em 3 de 3 execuções, cada uma com 3
snapshots. A atualização em si não foi observada: este Mac não oferece jeito de mudar o
número de CPUs ou um limite de CPU por baixo de um processo rodando.

### Medido: padrão, sobrescritas, SetDefaultGOMAXPROCS

```go
show("start")
stw := read("/sched/pauses/total/other:seconds")
runtime.GOMAXPROCS(4)
show("after runtime.GOMAXPROCS(4)")
runtime.GOMAXPROCS(4) // mesmo valor: sem stop-the-world
runtime.SetDefaultGOMAXPROCS()
show("after SetDefaultGOMAXPROCS()")
fmt.Println("non-GC stop-the-world pauses:", read("/sched/pauses/total/other:seconds")-stw)
```

```text
$ ./defaults
start                              NumCPU=14 GOMAXPROCS=14 metric=14
after runtime.GOMAXPROCS(4)        NumCPU=14 GOMAXPROCS=4 metric=4
after SetDefaultGOMAXPROCS()       NumCPU=14 GOMAXPROCS=14 metric=14
non-GC stop-the-world pauses: 2
$ GOMAXPROCS=6 ./defaults
start                              NumCPU=14 GOMAXPROCS=6 metric=6
after runtime.GOMAXPROCS(4)        NumCPU=14 GOMAXPROCS=4 metric=4
after SetDefaultGOMAXPROCS()       NumCPU=14 GOMAXPROCS=14 metric=14
non-GC stop-the-world pauses: 2
```

Idêntico em 3 execuções de cada. `metric` é `/sched/gomaxprocs:threads`. Toda mudança é
um stop-the-world (duas pausas para duas mudanças; o `GOMAXPROCS(4)` repetido voltou
cedo, como o código faz quando `n == ret`). `SetDefaultGOMAXPROCS` ignorou o
`GOMAXPROCS=6`: a doc diz que ele restaura o padrão "ignoring the GOMAXPROCS environment
variable", e religa as atualizações automáticas.

### A linha go do go.mod decide

Os dois comportamentos são settings do GODEBUG, e os padrões do GODEBUG seguem a linha
`go` do módulo principal. O mesmo programa compilado pela 1.27.0 com `go 1.24`:

```text
$ go version -m bin/legacy124 | grep DefaultGODEBUG
	build	DefaultGODEBUG=containermaxprocs=0,cryptocustomrand=1,decoratemappings=0,tlssecpmlkem=0,tlssha1=1,tracebacklabels=0,updatemaxprocs=0,urlstrictcolons=0,x509sha256skid=0,x509sslcertoverrideplatform=0
```

Nenhuma goroutine updater em 3 de 3 execuções. Um bloco `godebug` (Go 1.23+, segundo a
doc do GODEBUG) trouxe os dois de volta mantendo `go 1.24`:

```text
godebug (
	containermaxprocs=1
	updatemaxprocs=1
)
```

O `DefaultGODEBUG` passou a mostrar `containermaxprocs=1` e `updatemaxprocs=1`, e a
updater voltou em 3 de 3 execuções. Uma lacuna para auditoria de frota: o código diz
que, com `updatemaxprocs=0`, incrementa `/godebug/non-default-behavior/updatemaxprocs:events`
"unconditionally", mas o contador ficou em 0 em 9 de 9 execuções, também com `net/http`
linkado (que traz o `internal/godebug`). Lendo o código, o incremento roda em
`runtime.main` antes de o `internal/godebug` registrar seu gancho, então ele se perde.

### Limite de paralelismo versus limite de vazão

O modelo do blog: `GOMAXPROCS` limita paralelismo; um limite de CPU limita tempo de CPU
por período (100 ms por padrão). "So an '8 CPU limit' is actually a limit of 800ms of
CPU time every 100ms of wall time." Passar disso faz o kernel aplicar throttling no
cgroup inteiro "for the remainder of the throttling period", o que machuca a latência de
cauda muito mais que um `GOMAXPROCS` menor, e rajadas do GC podem disparar isso mesmo
num serviço quase ocioso.

O que este Mac consegue mostrar é o outro lado: uma carga que precisa de mais CPU do que
o `GOMAXPROCS` permite. Um gerador em malha aberta oferece 4000 requisições por segundo
por 3 s; cada uma é uma goroutine fazendo cerca de 0,7 ms de SHA-256, então a carga
precisa de uns 2,8 núcleos. A latência é medida a partir do instante de chegada previsto:

```go
for i := range n {
	due := start.Add(time.Duration(i) * interval)
	if w := time.Until(due); w > 0 {
		time.Sleep(w)
	}
	wg.Go(func() {
		work()
		lat[i] = time.Since(due)
	})
}
```

```text
GOMAXPROCS=1    1485 req/s  CPU  1.0 cores  p50=3.5708s  p99=5.1431s  max=5.1769s  sched p99<=5.36870912s
GOMAXPROCS=2    2853 req/s  CPU  2.0 cores  p50=501.9ms  p99=1.4052s  max=1.4194s  sched p99<=1.610612736s
GOMAXPROCS=3    3999 req/s  CPU  2.8 cores  p50=700µs    p99=2.5ms    max=9ms      sched p99<=768ns
GOMAXPROCS=4    3999 req/s  CPU  2.9 cores  p50=800µs    p99=800µs    max=900µs    sched p99<=2.56µs
GOMAXPROCS=14   3999 req/s  CPU  2.9 cores  p50=800µs    p99=800µs    max=2.2ms    sched p99<=3.584µs
GOMAXPROCS=56   3999 req/s  CPU  2.9 cores  p50=800µs    p99=800µs    max=1.1ms    sched p99<=3.072µs
```

Repetido nas 3 execuções: com 1 e 2 Ps a vazão parou em 1,3 mil a 1,5 mil e cerca de
2,85 mil req/s, e a fila cresceu durante toda a execução (p50 de 0,5 a 3,6 s; `sched
p99` é o limite do bucket de `/sched/latencies`). De 3 Ps para cima, 11 de 12 execuções
sustentaram a taxa oferecida (3965 a 3999 req/s) com p50 de 0,7 a 0,8 ms; 14 e 56 Ps não
mostraram diferença repetível. As caudas oscilaram: esta máquina rodava outros jobs
(load average de 8 a 13), e uma execução com 4 Ps caiu para 3781 req/s com p50 de 108
ms. Um `GOMAXPROCS` acima do necessário não custa nada mensurável quando há CPU livre;
o custo dele num contêiner é o throttling, que exige um cgroup de verdade para medir.

## Trade-offs

- **Limit versus só request**: com limit, o `GOMAXPROCS` acompanha e a latência fica
  previsível, mas o pod não usa CPU ociosa do nó. Só com request ele usa, e o
  `GOMAXPROCS` fica nos núcleos do nó; o blog aponta "a small container receiving 2 CPUs
  running on a 128 core machine" como o caso a corrigir com um limit ou um valor explícito.
- **Arredondar para cima e o piso de 2**: pela regra da doc, um limite `500m` recebe 2
  Ps. Pela aritmética, duas threads ocupadas gastam 50 ms de quota em 25 ms de relógio e
  o cgroup sofre throttling nos 75 ms restantes do período. Um limite abaixo de 2 CPUs
  sempre começa com mais Ps do que quota; `2500m` recebe 3 Ps, que também podem passar de 2,5.
- **Configuração explícita congela o valor**: a variável de ambiente ou uma chamada
  `runtime.GOMAXPROCS(n)` com `n > 0` (que é o que o `automaxprocs` faz) desliga as
  atualizações automáticas, então um pod redimensionado fica com o valor antigo.
  `SetDefaultGOMAXPROCS` devolve o controle (medido acima).
- **Cada mudança para o mundo**: medido como uma pausa não-GC por mudança efetiva. O
  runtime checa no máximo uma vez por segundo, então atualizações são raras, mas cada
  uma pausa todas as goroutines.
- **A linha go é a chave**: trocar só a toolchain mantém os padrões antigos (medido com
  `go 1.24`); suba a linha `go` ou use um bloco `godebug`.

## Documentation Links

- [Container-aware GOMAXPROCS, The Go Blog (Michael Pratt and Carlos Amedee, 2025)](https://go.dev/blog/container-aware-gomaxprocs): doc
- [Go 1.25 Release Notes: container-aware GOMAXPROCS, SetDefaultGOMAXPROCS, go.dev](https://go.dev/doc/go1.25): doc
- [runtime.GOMAXPROCS and SetDefaultGOMAXPROCS, pkg.go.dev](https://pkg.go.dev/runtime#GOMAXPROCS): doc
- [Go, Backwards Compatibility, and GODEBUG (containermaxprocs, updatemaxprocs, godebug blocks), go.dev](https://go.dev/doc/godebug): doc
- [runtime/cgroup_linux.go at go1.27.0, go.googlesource.com](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/cgroup_linux.go): doc
- [Go issue 73193: runtime: CPU limit-aware GOMAXPROCS default (proposal discussion)](https://go.dev/issue/73193): doc
- [Kubernetes: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): doc
- [Linux kernel docs: Control Group v2 (cpu.max)](https://docs.kernel.org/admin-guide/cgroup-v2.html): doc
