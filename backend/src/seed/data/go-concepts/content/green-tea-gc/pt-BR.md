---
version: 1.0
updatedAt: 2026-11-13
title: "Green Tea GC"
summary: O Green Tea, algoritmo de marcação padrão desde o Go 1.26, que enfileira spans em vez de objetos e varre de uma vez os objetos marcados de cada span; os dois conjuntos de bits por span e a janela de 16 a 512 bytes lidos no código do runtime; o opt-out GOEXPERIMENT=nogreenteagc, que ainda compila no Go 1.27.0 apesar das notas da 1.26; CPU de GC por ciclo medida em arm64 com e sem Green Tea em três formatos de heap (50 a 58% a menos num grafo de objetos pequenos, empate numa cadeia longa, 26 a 38% a mais em objetos de 2 KiB) e num laço guiado por alocação (cerca de 50% a menos); e a comparação com os 10 a 40% das notas de lançamento.
---
## Objective

O Green Tea é o algoritmo de marcação que virou padrão no Go 1.26: em vez de uma
lista de trabalho de objetos, o coletor mantém uma fila de spans (páginas de 8 KiB
com objetos do mesmo tamanho) e varre de uma vez todos os objetos marcados de um
span. Esta lição explica o projeto a partir do blog do Go e do código do runtime,
confere qual opt-out existe de verdade no Go 1.27.0 compilando com ele, e mede a CPU
de GC por ciclo com e sem Green Tea em três formatos de heap (muitos objetos pequenos
com ponteiros aleatórios, uma cadeia longa, poucos objetos grandes) mais um laço
guiado por alocação, parecido com um serviço, e depois compara o resultado com os 10
a 40% que as notas de lançamento prometem. Medido com Go 1.27.0
(`GOTOOLCHAIN=go1.27.0`, linha `go 1.27` no módulo) num Apple M4 Max (14 núcleos,
arm64), macOS 27.0.1, pelo menos 3 execuções intercaladas por configuração. A máquina era
dividida com outros benchmarks, então o número reportado é tempo de CPU por ciclo,
não tempo de relógio.

## Use Cases

- Subir um serviço para o Go 1.26 ou posterior e prever se a CPU de GC cai.
- Fazer teste A/B de uma suspeita de regressão de GC depois da atualização com `GOEXPERIMENT=nogreenteagc`.
- Escolher layout de dados: muitos objetos pequenos com ponteiros contra arrays grandes de ponteiros.
- Ler uma afirmação de fornecedor ou de blog sobre overhead de GC contra o formato do seu heap.

## Deep Dive

### A inundação do grafo e por que ela emperra

Antes do Green Tea, marcar era inundar um grafo: tirar um objeto de uma lista de
trabalho LIFO, varrer os ponteiros dele, empilhar cada objeto recém-marcado. O blog
relata que cerca de 90% do custo do GC é marcação e que pelo menos 35% do tempo de
marcação é gasto esperando memória, porque objetos consecutivos na lista ficam em
páginas sem relação. Cada varredura é pequena e depende da carga anterior, então a
CPU não consegue sobrepor os cache misses.

### Green Tea: enfileirar spans, não objetos

O código do runtime (`runtime/mgcmark_greenteagc.go` na 1.27.0) descreve o núcleo:
dois conjuntos de bits por span, guardados no fim do próprio span.

```go
type spanInlineMarkBits struct {
	scans [63]uint8         // scanned bits.
	owned spanScanOwnership // see the comment on spanScanOwnership.
	marks [63]uint8         // mark bits.
	class spanClass
}
```

Achar um ponteiro liga o bit do objeto em `marks` e enfileira o span, não o objeto.
A fila de spans é FIFO, então, enquanto um span espera, mais objetos dele são
marcados. Quando o span sai da fila, `marks` menos `scans` dá os objetos a varrer, e
eles são varridos em ordem de endereço. Um span pode entrar na fila várias vezes por
ciclo. Três detalhes do código importam para o desempenho:

- **Janela de tamanho**: `gcUsesSpanInlineMarkBits` é `heapBitsInSpan(size) && size >= 16`,
  e `heapBitsInSpan` significa no máximo 512 bytes. Objetos maiores ficam no caminho antigo, por objeto.
- **Atalho de objeto único**: `spanScanOwnership` registra se chegou uma marca ou mais
  de uma, então um span com um só objeto pula a fusão dos dois conjuntos de bits.
- **Kernel vetorial**: o código de varredura com AVX-512 e GFNI em
  `internal/runtime/gc/scan` só existe como assembly `_amd64`. Em arm64 (esta máquina)
  roda o caminho genérico, que é a configuração a que o "10% to 40%, even without the
  vector enhancements" do blog se refere.

### Qual coletor está neste binário? O opt-out na 1.27.0

As notas do Go 1.26 dizem que o opt-out "is expected to be removed in Go 1.27". Não
foi: `internal/buildcfg/exp.go` na 1.27.0 ainda tem `GreenTeaGC: true` na linha de
base, e as notas da 1.27 não mencionam o Green Tea. Compilando dos dois jeitos:

```bash
$ go build -o bin/gt-on ./gtbench
$ GOEXPERIMENT=nogreenteagc go build -o bin/gt-off ./gtbench
$ go version -m bin/gt-off | grep GOEXPERIMENT
	build	GOEXPERIMENT=nogreenteagc
$ GOEXPERIMENT=nogreentea go build -o /dev/null ./gtbench
go: unknown GOEXPERIMENT greentea
```

O binário padrão não tem linha `GOEXPERIMENT` nenhuma, então a ausência dela
significa Green Tea. A configuração só é lida pelo compilador e pelo linker: rodar
`gt-on` com `GOEXPERIMENT=nogreenteagc` no ambiente ainda mediu de 222 a 256 ms por
ciclo no heap de grafo, o número do Green Tea.

### O benchmark: heap fixo, ciclos forçados

O `gtbench` monta um heap vivo de cerca de 256 MB, roda duas chamadas de
`runtime.GC()` de aquecimento, depois força 10 ou 20 ciclos (3 ou 5 na cadeia, que é
lenta) e divide o tempo de CPU do processo (`getrusage`) pelo número de ciclos. Um
ciclo forçado marca e faz sweep do heap inteiro, então isto é custo de GC por ciclo
sem mais nada rodando:

```go
case "graph": // objetos pequenos, 4 ponteiros aleatórios cada
	n := mb << 20 / 64
	s := make([]*small, n)
	for i := range s {
		s[i] = &small{}
	}
	for _, x := range s {
		for j := range x.p {
			x.p[j] = s[r.IntN(n)]
		}
	}
	root = s
case "list": // uma cadeia por objetos pequenos em ordem aleatória de endereço
	n := mb << 20 / 16
	// ... aloca n *link, depois encadeia na ordem de r.Perm(n)
	root = s[perm[0]] // só a cabeça é raiz, o slice morre
case "large": // poucos objetos grandes com ponteiros
	n := mb << 20 / 2048 // structs de 2 KiB com 256 ponteiros, cada um para um large aleatório
```

CPU por ciclo, faixas em 3 a 6 execuções:

```text
shape  objects     GOMAXPROCS  Green Tea      nogreenteagc   change
graph   4,194,485  1           221-228 ms     494-543 ms     -55% to -58%
graph   4,194,596  14          322-358 ms     704-742 ms     -50% to -55%
list   16,777,395  1           2,106-2,279 ms 2,119-2,274 ms within 4%, no consistent winner
list   16,777,507  14          2,226-2,259 ms 2,267-2,400 ms -2% to -6%
large     131,253  1           260-278 ms     205-215 ms     +26% to +29%
large     131,368  14          358-372 ms     260-286 ms     +29% to +38%
```

### Um laço guiado por alocação

Ciclos forçados isolam a marcação, mas serviços pagam o GC pelo pacer. O mesmo laço
`churn` da lição de GOGC (nós de 64 bytes, 256 MB vivos, 8 GiB alocados,
`GOGC=100`), com 4 goroutines alocando em `GOMAXPROCS=4`, para nenhum P ficar ocioso
e os workers ociosos não borrarem a CPU de GC (`/cpu/classes/gc/total` menos idle):

```text
on   cycles 22  peak 840 MB  gc cpu 2.78s (assist 0.98s)  gc/busy 23%  wall 3.09s
off  cycles 22  peak 866 MB  gc cpu 5.38s (assist 2.58s)  gc/busy 34%  wall 4.16s
```

Em 6 execuções: 21 a 23 ciclos nos dois binários, CPU de GC de 2,75 a 2,86 s com
Green Tea contra 5,38 a 5,78 s sem (cerca de 50% a menos), assists cortados em mais
da metade, e o laço inteiro de 20 a 26% mais rápido.

### Onde o ganho não aparece

- **Uma cadeia longa**: cada nó só é descoberto depois de o anterior ser varrido,
  então todo span sai da fila com um único objeto marcado. É o caso que o blog diz
  poder ficar pior que a inundação do grafo; o atalho de objeto único manteve o
  empate aqui. Ele também é serial: com 14 Ps o ciclo ainda levou cerca de 2,2 s de
  relógio, o mesmo que o tempo de CPU.
- **Objetos acima de 512 bytes**: ficam fora da janela de span, e mesmo assim o
  binário com Green Tea gastou de 26 a 38% a mais de CPU neles. Um perfil de CPU da
  execução com `GOMAXPROCS=1` mostra o motivo: `runtime.tryDeferToSpanScan` ficou com
  21,6% das amostras no binário com Green Tea. Todo ponteiro passa primeiro por essa
  consulta, que devolve false para um alvo de 2 KiB, e só depois pelo caminho antigo
  de `findObject` e `greyobject`.
- **Contra a promessa de 10 a 40%**: os formatos grafo e churn passam de 40%, mas são
  o melhor caso (objetos uniformes de 64 bytes, ponteiros aleatórios que empilham
  marcas nos mesmos spans). O próprio blog põe a melhora mais comum perto de 10%; um
  heap real mistura os três formatos acima, então meça o seu com o binário de opt-out
  antes e depois.

## Trade-offs

- **O formato do heap decide o ganho**: muitos objetos pequenos com ponteiros, de uma
  mesma classe de tamanho, ganham mais; cadeias profundas não ganham nada; arrays
  grandes de ponteiros pagam uma pequena taxa. Exemplo: um `[]*Item` com itens de 300
  bytes se beneficia, um `map` de structs de 2 KiB não.
- **Aceleração vetorial só em amd64**: o kernel AVX-512 precisa de Ice Lake ou Zen 4
  em diante; servidores arm64 (Graviton, Ampere) rodam a varredura escalar de span.
- **O opt-out é temporário**: `nogreenteagc` ainda compila na 1.27.0 apesar das notas
  da 1.26, mas é uma flag de experimento marcada para remoção. Use para teste A/B e
  para abrir uma issue, não como configuração permanente.
- **Benchmark de ciclo forçado mede custo por ciclo, não ritmo**: o Green Tea não muda
  a frequência do GC (21 a 23 ciclos nos dois binários); muda o que cada ciclo custa.
  GOGC e GOMEMLIMIT continuam sendo os controles de frequência.

## Documentation Links

- [The Green Tea Garbage Collector, The Go Blog (Knyszek and Clements, 2025)](https://go.dev/blog/greenteagc): doc
- [Go 1.26 Release Notes: new garbage collector, go.dev](https://go.dev/doc/go1.26): doc
- [Go 1.27 Release Notes, go.dev](https://go.dev/doc/go1.27): doc
- [runtime: green tea garbage collector, golang/go issue 73581](https://github.com/golang/go/issues/73581): doc
- [runtime/mgcmark_greenteagc.go at go1.27.0, Go source](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/mgcmark_greenteagc.go): doc
- [internal/buildcfg/exp.go at go1.27.0 (GOEXPERIMENT baseline), Go source](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/internal/buildcfg/exp.go): doc
- [A Guide to the Go Garbage Collector, go.dev](https://go.dev/doc/gc-guide): doc
