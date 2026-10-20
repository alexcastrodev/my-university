---
version: 1.0
updatedAt: 2026-10-20
title: "Fuzzing Guiado por Cobertura"
summary: "Um fuzzer alimenta um programa com entradas mutadas e observa crashes. Fuzzers guiados por cobertura como AFL e libFuzzer instrumentam o alvo, guardam toda entrada que alcança código novo e mutam a partir delas, o que transforma uma busca cega exponencial em uma incremental; combinados com sanitizers, acham bugs de segurança de memória em parsers e código de protocolo em escala."
---
## Objetivos de Aprendizagem

- Descrever o fuzzing, o seu oráculo (crash, travamento, relatório de sanitizer, asserção) e a progressão de fuzzing aleatório para baseado em gramática e para guiado por cobertura.
- Explicar o laço do AFL: instrumentação de cobertura de arestas, uma fila de entradas interessantes e mutação.
- Escrever um harness no estilo libFuzzer e explicar o que faz um harness ser bom.
- Explicar o papel dos sanitizers, os limites do fuzzing (valores mágicos, checksums, estado profundo) e como o fuzzing se aplica a linguagens seguras em memória como o Java.

## Contexto e Motivação

`software-distributed/security-cryptography` mostrou como bugs de segurança de memória e falhas de injeção viram exploits, e `algorithms-software/software-construction` cobriu testes e depuração que partem de entradas em que uma pessoa pensou. O fuzzing parte da premissa oposta: deixe a máquina gerar milhões de entradas em que ninguém pensou e observe a falha. Em 1990, Miller, Fredriksen e So alimentaram utilitários UNIX comuns com bytes aleatórios e derrubaram ou travaram de um quarto a um terço deles. Entrada puramente aleatória, porém, é rasa, porque a maioria dos bytes aleatórios é rejeitada pela primeira checagem de validação e exercita só o caminho de erro.

O avanço veio com o fuzzing **guiado por cobertura**. O AFL (American Fuzzy Lop, Michal Zalewski, 2013) e depois o libFuzzer, o honggfuzz e o AFL++ acrescentam uma ideia: instrumentar o programa, observar que código cada entrada alcança e guardar qualquer entrada que alcance algo novo como semente para mais mutação. Isso transforma a busca de adivinhação em subida de encosta. O OSS-Fuzz do Google roda essas ferramentas continuamente sobre centenas de projetos de código aberto e já reportou milhares de bugs, muitos deles vulnerabilidades de segurança em parsers de imagens, fontes, arquivos compactados e protocolos de rede. *The Fuzzing Book*, de Zeller et al., é uma introdução gratuita e executável.

## Teoria Central

### A estrutura de um fuzzer

Um fuzzer é um laço: produzir uma entrada, rodar o **alvo** nela e consultar um **oráculo** que diz se a execução foi uma falha. Para um fuzzer genérico o oráculo é "o programa não caiu nem travou", o que parece fraco mas fica forte quando combinado com **sanitizers**: instrumentação do compilador que transforma corrupção silenciosa de memória em um crash imediato e reportável. O AddressSanitizer (ASan) detecta acessos fora dos limites e uso após liberação, o UndefinedBehaviorSanitizer (UBSan) detecta overflow e deslocamentos inválidos, o MemorySanitizer detecta leituras de memória não inicializada e o ThreadSanitizer detecta data races. Asserções e checagens de propriedade (por exemplo, "decodificar e depois codificar devolve o original") ampliam o oráculo.

### Três gerações

1. **Aleatório de caixa-preta**: gerar bytes aleatórios. Fácil, mas quase toda entrada morre na primeira checagem.
2. **Baseado em gramática ou ciente da estrutura**: gerar ou mutar entradas segundo uma gramática ou especificação de formato (o fuzzing de compiladores C com o Csmith, fuzzers de protocolo, mutadores baseados em protobuf). As entradas passam pelo parser e alcançam código mais profundo, mas alguém precisa escrever a gramática.
3. **Greybox guiado por cobertura**: usar um feedback leve do programa (greybox, entre a caixa-preta e o raciocínio whitebox da execução simbólica) para evoluir um corpus.

### O laço do AFL

O AFL instrumenta cada bloco básico em tempo de compilação. Cada bloco recebe um identificador aleatório, e o programa atualiza um bitmap compartilhado de 64 KB em cada **aresta** do fluxo de controle: incrementa `bitmap[prev ^ cur]` e faz `prev = cur >> 1` (o deslocamento mantém a aresta A para B distinta de B para A). As contagens de acertos são agrupadas em faixas (1, 2, 3, 4 a 7, 8 a 15 e assim por diante). O laço principal é:

1. Pegar uma entrada da **fila** (inicialmente o corpus de sementes fornecido pelo usuário).
2. **Mutá-la**: estágios determinísticos (inverter cada bit, inverter bytes, somar ou subtrair inteiros pequenos, inserir valores "interessantes" como 0, -1, 255, 65535), depois um estágio aleatório "havoc" que empilha muitas mutações e um estágio de splice que combina duas entradas.
3. Rodar o mutante. Se ele alcança uma aresta ou faixa de contagem nunca vista, adicioná-lo à fila. Se cai, salvá-lo.
4. Repetir por horas ou dias.

Um **fork server** evita o custo de `exec` por execução, e o **modo persistente** reutiliza o processo para muitas entradas. Ferramentas de minimização de corpus (`afl-cmin`, `afl-tmin`) reduzem a fila e cada crash a um reprodutor pequeno.

O libFuzzer segue a mesma ideia **dentro do processo**: o fuzzer é ligado ao alvo e chama repetidamente uma função que você escreve, usando o SanitizerCoverage do LLVM como feedback, de modo que cada execução custa microssegundos.

### Escrevendo um bom harness

Um harness é a função que alimenta bytes ao código sob teste. No libFuzzer é `int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)`. Um bom harness é:

- **Determinístico**: os mesmos bytes sempre dão o mesmo comportamento, sem estado global escondido, relógio ou aleatoriedade; do contrário o feedback de cobertura fica ruidoso e os crashes não se reproduzem.
- **Rápido**: milhares de execuções por segundo; evite sistema de arquivos, rede e criação de processos.
- **Estreito**: mira um parser ou decodificador na fronteira onde dados não confiáveis entram, em vez de um programa inteiro.
- **Acompanhado de corpus de sementes e dicionário** (`-dict=`) com palavras-chave e números mágicos do formato, o que acelera o avanço pelas checagens de formato.

### Limites

O feedback de cobertura não satisfaz facilmente uma condição como `crc32(data) == header_crc` ou um número mágico de 4 bytes checado por uma única comparação, porque o progresso parcial é invisível: o desvio é tomado ou não. As mitigações incluem dicionários, instrumentar comparações para que bytes que casam sejam notados (laf-intel, CmpLog/RedQueen, o value profile do libFuzzer) e ferramentas híbridas que chamam um executor simbólico nos desvios travados. O fuzzing também sofre com protocolos profundos e com estado, em que muitos passos válidos precedem o bug, e nunca pode provar a ausência de bugs: uma execução longa que não acha nada é evidência, não garantia.

### Fuzzing de linguagens seguras em memória

Em Java, Rust ou Go, um acesso fora dos limites lança exceção ou entra em panic em vez de corromper memória, mas o fuzzing continua valioso: acha exceções não tratadas, laços infinitos, uso excessivo de memória (`OutOfMemoryError`), esgotamento de pilha com entrada profundamente aninhada e bugs lógicos revelados por checagens de propriedade (idas e voltas, comparação diferencial de duas implementações). O **Jazzer** leva o libFuzzer à JVM, com detectores extras para padrões de injeção, e o **JQF** combina guia por cobertura com testes baseados em propriedades. O fuzzing também compensa em Rust, nas partes `unsafe` e no comportamento de `panic` diante de entrada malformada.

## Exemplos Resolvidos

### Exemplo 1: por que feedback vence adivinhação

**Problema:** Quantas execuções são necessárias para chegar ao `abort()` abaixo com entrada puramente aleatória e com fuzzing guiado por cobertura?

```c
void check(const uint8_t *d, size_t n) {
    if (n >= 4 && d[0] == 'F')
        if (d[1] == 'U')
            if (d[2] == 'Z')
                if (d[3] == 'Z')
                    abort();
}
```

**Solução:** A entrada aleatória cega precisa produzir os quatro bytes específicos de uma vez: probabilidade $2^{-32}$ por tentativa, cerca de 4 bilhões de execuções em média. Um fuzzer guiado por cobertura acha `F` no primeiro byte depois de cerca de $256$ tentativas de mutações de um byte; essa entrada alcança uma aresta nova (o segundo `if`), então é guardada. Mutar a entrada guardada acha `U` no segundo byte depois de cerca de mais 256 tentativas, e assim por diante. Cada estágio custa da ordem de $256$ tentativas, então cerca de $4 \times 256 \approx 1000$ execuções no total mais a sobrecarga de mutação, uma redução por um fator de milhões. O feedback transforma uma conjunção de condições independentes de um produto em uma soma.

### Exemplo 2: um harness e um bug achado pelo ASan

**Problema:** Achar o bug neste parser com um fuzzer.

```c
// parser.c
#include <stdint.h>
#include <string.h>

int parse_record(const uint8_t *data, size_t size) {
    if (size < 1) return -1;
    uint8_t len = data[0];            // o byte de tamanho vem da entrada
    char buf[16];
    memcpy(buf, data + 1, len);       // confia em len: estoura quando len > 16
    return buf[0];
}

// fuzz.c
#include <stdint.h>
#include <stddef.h>
int parse_record(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    parse_record(data, size);
    return 0;
}
```

Compilar e rodar: `clang -g -O1 -fsanitize=fuzzer,address parser.c fuzz.c -o fuzz && ./fuzz corpus/`.

**Solução:** Em segundos o fuzzer acha uma entrada cujo primeiro byte passa de 16 e cujos bytes seguintes estão presentes. O ASan reporta um estouro de buffer no `memcpy` (uma escrita `stack-buffer-overflow`, ou uma leitura `heap-buffer-overflow` quando `len` também excede o tamanho da entrada), grava a entrada num arquivo `crash-<hash>` e termina. Rodar de novo `./fuzz crash-<hash>` reproduz a falha de forma determinística, e `-minimize_crash=1` a reduz. A correção é `if (len > sizeof buf || (size_t)len + 1 > size) return -1;`. Sem o ASan, o estouro poderia corromper a pilha em silêncio e talvez não causar crash, e é por isso que sanitizers fazem parte da configuração.

### Exemplo 3: fuzzing de um parser JSON em Java

**Problema:** Escrever um harness do Jazzer para `Json.parse(String)` que trate JSON inválido como normal e qualquer outra coisa como bug.

```java
public static void fuzzerTestOneInput(FuzzedDataProvider data) {
    String text = data.consumeRemainingAsString();
    Object value;
    try {
        value = Json.parse(text);
    } catch (JsonParseException expected) {
        return;                              // entrada malformada é aceitável
    }
    // propriedade: imprimir e depois analisar devolve o mesmo valor
    if (!value.equals(Json.parse(Json.print(value)))) {
        throw new AssertionError("round trip changed " + value);
    }
}
```

**Solução:** O `catch` documenta o contrato: `JsonParseException` é a reação declarada do parser a entrada ruim. Qualquer outro throwable que escape (`NullPointerException`, `StackOverflowError` por arrays profundamente aninhados, `OutOfMemoryError` por um tamanho patológico, uma `ClassCastException`) é reportado com a entrada que o causou. A propriedade de ida e volta transforma um oráculo só de crash em um oráculo de correção, e acha bugs como formatação de números que perde precisão ou escapes Unicode tratados de forma inconsistente.

## Equívocos Comuns e Armadilhas

- **"Fuzzing é só para C e C++."** A corrupção de memória é o alvo clássico, mas qualquer linguagem se beneficia para exceções não tratadas, esgotamento de recursos e violações de propriedades.
- **"Mais cobertura significa uma campanha de fuzzing melhor."** Cobertura é um meio. Um fuzzer pode saturar a cobertura de arestas e ainda perder um bug que depende de um valor ou estado particular; o oráculo (sanitizers, asserções, propriedades) decide o que é detectável.
- **"Um fuzzer que rodou uma hora sem crash mostra que o código é seguro."** Mostra que a parte explorada do espaço de entradas está limpa. Campanhas devem rodar continuamente (OSS-Fuzz, fuzzing em CI a cada mudança), partindo de um corpus que continua crescendo.
- **"Fuzzing substitui testes unitários."** Ele acha o que ninguém previu, mas não diz se uma saída de aparência correta é a certa. Use os dois: fuzzing para robustez, testes e propriedades para comportamento.

## Resumo

Um fuzzer gera entradas, roda o alvo e consulta um oráculo, reforçado por sanitizers que transformam corrupção de memória em crashes. Fuzzers guiados por cobertura como AFL e libFuzzer instrumentam arestas, guardam toda entrada que alcança código novo e mutam a partir desse corpus, o que muda a busca por uma conjunção de condições de exponencial para aproximadamente linear. Um bom harness é determinístico, rápido e estreito, com corpus de sementes e dicionário. Valores mágicos, checksums e estado profundo continuam difíceis, e abordagens híbridas com execução simbólica tratam parte deles. Em linguagens seguras em memória, o fuzzing acha exceções, esgotamento de recursos e propriedades violadas. O próximo conceito olha o ferramental que cerca todas essas análises no trabalho diário: como os editores conversam com a análise consciente da linguagem por meio de language servers, e como essa análise se mantém rápida.

## Documentation Links

- [Miller, Fredriksen, So: An Empirical Study of the Reliability of UNIX Utilities (Communications of the ACM, 1990)](https://dl.acm.org/doi/10.1145/96267.96279): doc
- [AFL technical details (lcamtuf)](https://lcamtuf.coredump.cx/afl/technical_details.txt): doc
- [The Fuzzing Book (Zeller et al.)](https://www.fuzzingbook.org/): doc
- [LLVM documentation: libFuzzer](https://llvm.org/docs/LibFuzzer.html): doc
