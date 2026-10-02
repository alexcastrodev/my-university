---
version: 1.0
updatedAt: 2026-09-06
title: Formatos de Instrução e Modos de Endereçamento
summary: "Como os 32 bits de uma instrução são recortados em um opcode, números de registradores e um valor imediato ou deslocamento, e as diferentes formas de uma instrução indicar onde seus dados de fato estão."
---
## Objetivos de Aprendizagem

- Explicar por que uma instrução de largura fixa de 32 bits exige vários leiautes de campos distintos (formatos), dado que instruções diferentes carregam tipos diferentes de operandos.
- Identificar os formatos de instrução R, I, S e B pelas fronteiras exatas dos seus campos de bits, e dizer quais campos os formatos têm em comum.
- Decodificar os campos opcode, funct3 e funct7 de uma instrução para determinar qual operação específica ela codifica.
- Descrever como os imediatos são empacotados nos formatos I, S e B, incluindo por que os bits do imediato do tipo B são reordenados ("embaralhados") em vez de guardados de forma contígua.
- Distinguir os quatro modos de endereçamento presentes nesta ISA (registrador, imediato, base+deslocamento e relativo ao PC) e dizer qual combinação de instrução e campo realiza cada um.

## Contexto e Motivação

Um conceito anterior desta disciplina apresentou um conjunto de instruções simples no estilo RISC-V: um catálogo fixo de operações como `add`, `addi`, `lw`, `sw` e `beq`, cada uma com 32 bits de largura. Fixar a largura da instrução em exatamente 32 bits é uma simplificação deliberada: a unidade de busca sempre pode pegar exatamente quatro bytes da memória e saber que tem uma instrução completa, sem precisar de análise de comprimento variável. Mas uma largura fixa cria uma tensão imediata: `add x5, x6, x7` precisa de três registradores, enquanto `addi x5, x6, 10` precisa de dois registradores mais uma constante numérica, e `sw x5, 8(x6)` precisa de dois registradores mais um deslocamento constante que significa algo diferente de um operando aritmético. Se toda instrução usasse um único leiaute rígido de campos, algumas instruções desperdiçariam bits de que não precisam, enquanto outras não teriam espaço para os operandos de que precisam. A solução usada pelo RV32I, explicada no tratamento do conjunto de instruções RISC-V de Harris & Harris, é definir alguns leiautes de campos diferentes (os *formatos* de instrução), cada um ainda com exatamente 32 bits, mas cada um recortando esses bits em regiões de tamanhos diferentes conforme os operandos de que aquela família precisa.

Isso não é só contabilidade. A escolha dos formatos tem consequências de hardware das quais conceitos posteriores dependem: o banco de registradores do datapath sempre lê suas entradas de "qual registrador" das mesmas posições de bits fixas, seja qual for o formato, e a lógica de geração de imediatos da unidade de controle pode ser construída como hardware combinacional fixo, desde que as posições de bits específicas de cada formato sejam conhecidas de antemão. Entender os formatos de instrução é, no fundo, entender uma disciplina de projeto de hardware: manter o máximo possível de campos em posições idênticas entre os formatos, para que os mesmos fios e a mesma lógica de decodificação possam ser reaproveitados em toda instrução que a máquina executa. Este conceito também apresenta os modos de endereçamento: as diferentes formas de uma instrução indicar onde estão os dados dos seus operandos, seja o conteúdo de um registrador, uma constante literal, um local de memória calculado a partir de um registrador mais um deslocamento, ou um local de código relativo à instrução em execução. Modos de endereçamento e formatos são dois lados da mesma ideia: o formato determina quais bits estão disponíveis para expressar um modo, e o modo determina como esses bits são usados depois de decodificados.

## Teoria Central

### Por que um único formato não serve para toda instrução

Toda instrução RV32I tem 32 bits de largura, e todo formato reserva os 7 bits mais baixos, `[6:0]`, para o opcode, que identifica de forma ampla a família da instrução (aritmética entre registradores, aritmética com imediato, load, store, desvio). Além do opcode, os 25 bits restantes são recortados de forma diferente por família:

- A aritmética entre registradores (`add`, `sub`, `and`, `or`, `slt`) precisa de três registradores (duas origens, um destino) sem imediato, então todo bit restante identifica a operação exata.
- A aritmética de registrador mais imediato (`addi`) e os loads (`lw`) precisam de um registrador de destino, um registrador de origem e uma constante numérica, deixando menos espaço para campos de registrador que o tipo R, mas exigindo espaço para uma constante de que o tipo R não precisa.
- Os stores (`sw`) precisam de dois registradores de origem (base do endereço e valor a guardar) mais um deslocamento constante, mas nenhum registrador de destino, uma assimetria que força o imediato a ser dividido em dois pedaços.
- Os desvios (`beq`) precisam de dois registradores de origem para comparar e de um deslocamento com sinal até uma instrução próxima, mas esse deslocamento é sempre múltiplo de 2 (toda instrução aqui tem 4 bytes), o que libera um bit extra de alcance.

Essas quatro necessidades produzem os quatro formatos que este conceito cobre: tipo R, tipo I, tipo S e tipo B.

### O formato tipo R (aritmética entre registradores)

| Bits | 31-25 | 24-20 | 19-15 | 14-12 | 11-7 | 6-0 |
|---|---|---|---|---|---|---|
| Campo | funct7 | rs2 | rs1 | funct3 | rd | opcode |
| Largura | 7 bits | 5 bits | 5 bits | 3 bits | 5 bits | 7 bits |

O tipo R não carrega imediato nenhum: todo bit identifica registradores ou a operação. `rs1` e `rs2` são os dois números de registrador de origem de 5 bits (5 bits endereçam todos os 32 registradores, de x0 a x31), `rd` é o destino de 5 bits, e `funct3` junto com `funct7` desfazem a ambiguidade sobre qual operação é feita, já que o opcode sozinho (`0110011` para toda instrução tipo R aqui) é compartilhado por todas elas.

### O formato tipo I (aritmética com imediato e loads)

| Bits | 31-20 | 19-15 | 14-12 | 11-7 | 6-0 |
|---|---|---|---|---|---|
| Campo | imm[11:0] | rs1 | funct3 | rd | opcode |
| Largura | 12 bits | 5 bits | 3 bits | 5 bits | 7 bits |

O tipo I substitui os campos `rs2` e `funct7` do tipo R por um único imediato contíguo de 12 bits nos bits `[31:20]`. Como `rs1`, `funct3`, `rd` e `opcode` ficam nas mesmas posições que no tipo R, a lógica de decodificação nunca precisa tratar de forma especial o tipo R versus o tipo I ao ler `rs1` ou `rd`; só a região do imediato versus `rs2`/`funct7` difere. O imediato passa por extensão de sinal para 32 bits antes do uso, dando uma faixa de -2048 a +2047. `addi` (opcode `0010011`, funct3 `000`) e `lw` (opcode `0000011`, funct3 `010`) são ambos tipo I: no `addi`, o imediato é somado diretamente a `rs1`; no `lw`, ele é um deslocamento em bytes somado a `rs1` para formar um endereço de memória.

### O formato tipo S (stores)

| Bits | 31-25 | 24-20 | 19-15 | 14-12 | 11-7 | 6-0 |
|---|---|---|---|---|---|---|
| Campo | imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode |
| Largura | 7 bits | 5 bits | 5 bits | 3 bits | 5 bits | 7 bits |

O `sw` (opcode `0100011`, funct3 `010`) não tem registrador de destino: o valor guardado vem de `rs2`, e o endereço vem de `rs1` mais o imediato. As posições de bits `[11:7]`, que guardam `rd` nos tipos R e I, são reaproveitadas no tipo S para guardar os 5 bits baixos do imediato, já que não há `rd` para um store produzir. Os 7 bits altos restantes vão para os bits `[31:25]`, exatamente onde o tipo R guarda o `funct7`. O imediato é assim dividido em dois pedaços não adjacentes, `imm[11:5]` e `imm[4:0]`, remontados por concatenação na decodificação: `imm[11:0] = instruction[31:25] : instruction[11:7]`. Essa divisão existe puramente para que `rs1`, `rs2` e `funct3` continuem nas mesmas posições que em todos os outros formatos.

### O formato tipo B (desvios) e o embaralhamento do imediato

| Bits | 31 | 30-25 | 24-20 | 19-15 | 14-12 | 11-8 | 7 | 6-0 |
|---|---|---|---|---|---|---|---|---|
| Campo | imm[12] | imm[10:5] | rs2 | rs1 | funct3 | imm[4:1] | imm[11] | opcode |
| Largura | 1 bit | 6 bits | 5 bits | 5 bits | 3 bits | 4 bits | 1 bit | 7 bits |

O `beq` (opcode `1100011`, funct3 `000`) é estruturalmente próximo do tipo S (compara dois registradores, sem registrador de destino), mas carrega um deslocamento de desvio em vez de um deslocamento de endereço de store. Como toda instrução aqui tem 4 bytes e os alvos de desvio caem em fronteiras de instrução, o deslocamento é sempre múltiplo de 2: o bit 0 é sempre 0 e nunca é guardado, então só 12 bits significativos de deslocamento (`imm[12:1]`) são codificados, dando uma faixa com sinal de aproximadamente -4096 a +4094 bytes com só 12 bits guardados. Em vez de guardar esses bits de forma contígua, os projetistas os reordenaram: `imm[12]` (o bit de sinal) vai para o bit 31, a mesma posição que o bit de sinal ocupa nos imediatos dos tipos I e S, para que um único circuito de extensão de sinal compartilhado funcione seja qual for o formato. `imm[11]` vai para o bit 7, `imm[10:5]` vai para os bits `[30:25]` (batendo com a posição de `imm[11:5]` no tipo S), e `imm[4:1]` vai para os bits `[11:8]` (batendo com os 4 bits baixos de `imm[4:0]` no tipo S). Isso é uma otimização de fiação, não um embaralhamento aleatório: permite que um único circuito de extração de imediatos cuide dos imediatos dos tipos I, S e B com fiação compartilhada mais um pequeno multiplexador. A decodificação remonta o deslocamento com sinal de 13 bits como `imm[12] : imm[11] : imm[10:5] : imm[4:1] : 0`, com o 0 final restaurando o bit nunca guardado.

### Opcode, funct3 e funct7: o esquema de decodificação

O opcode sozinho só estreita uma instrução até uma família (todas as operações de ULA tipo R compartilham o opcode `0110011`). Dentro de uma família, o `funct3` (3 bits) dá uma seleção mais fina, e, no tipo R, o `funct7` (7 bits) desfaz ainda a ambiguidade entre operações que compartilham o mesmo opcode e funct3, como `add` e `sub`.

| Instrução | opcode | funct3 | funct7 |
|---|---|---|---|
| add | 0110011 | 000 | 0000000 |
| sub | 0110011 | 000 | 0100000 |
| and | 0110011 | 111 | (n/a) |
| or | 0110011 | 110 | (n/a) |
| slt | 0110011 | 010 | (n/a) |
| addi | 0010011 | 000 | (n/a) |
| lw | 0000011 | 010 | (n/a) |
| sw | 0100011 | 010 | (n/a) |
| beq | 1100011 | 000 | (n/a) |

`add` e `sub` compartilham opcode e funct3, e só o funct7 os distingue; então a unidade de controle (um conceito posterior) precisa inspecionar os três campos juntos para identificar uma instrução, e não só o opcode.

### Modos de endereçamento nesta ISA

Um modo de endereçamento é uma regra de como os campos de operando de uma instrução localizam os dados sobre os quais ela de fato opera. Esta ISA tem quatro:

- **Endereçamento por registrador**: o operando é simplesmente o conteúdo de um registrador nomeado. Os três operandos do tipo R (`rs1`, `rs2`, `rd`) usam endereçamento por registrador: os dados estão nas entradas do banco de registradores que os campos nomeiam.
- **Endereçamento imediato**: o operando é uma constante codificada diretamente na instrução, sem precisar de consulta à memória nem a registrador. O imediato de 12 bits do `addi` é usado assim: com extensão de sinal e usado diretamente como operando da soma.
- **Endereçamento base+deslocamento**: o endereço de memória efetivo é um deslocamento constante (o imediato) somado ao conteúdo de um registrador base. `lw` e `sw` usam esse modo: `lw x5, 8(x6)` calcula seu endereço como `x6 + 8`, e `sw x5, 8(x6)` o calcula da mesma forma, guardando ali o valor de `x5`.
- **Endereçamento relativo ao PC**: o alvo é calculado em relação ao endereço da instrução em execução (o contador de programa, PC), e não como um endereço absoluto. O alvo de desvio do `beq` é `PC + deslocamento`, o que faz o mesmo desvio compilado funcionar corretamente onde quer que o programa seja carregado, já que o alvo é uma distância a partir "daqui", e não um endereço fixo.

## Exemplos Resolvidos

### Exemplo 1: dispondo cada campo da instrução tipo R `add x5, x6, x7`

O `add` calcula `x5 = x6 + x7`. Seus campos, usando a tabela do tipo R acima:

| Campo | Bits | Valor | Binário |
|---|---|---|---|
| funct7 | 31-25 | 0000000 (add) | 0000000 |
| rs2 | 24-20 | x7 | 00111 |
| rs1 | 19-15 | x6 | 00110 |
| funct3 | 14-12 | 000 (add) | 000 |
| rd | 11-7 | x5 | 00101 |
| opcode | 6-0 | ULA tipo R | 0110011 |

Concatenando do bit 31 ao bit 0: `0000000 00111 00110 000 00101 0110011`. Tirando os espaços: `00000000111001100000010100110011`, reagrupado em nibbles hex: `0000 0000 0111 0011 0000 0010 1011 0011` = `0x007302B3`, a codificação de referência de `add x5, x6, x7`.

### Exemplo 2: mapeando cada campo de `lw x5, 8(x6)` nas suas posições de bits

`lw x5, 8(x6)` carrega a palavra no endereço `x6 + 8` em `x5`. É tipo I, já que precisa de um registrador de destino, um registrador base e um imediato.

| Campo | Bits | Valor | Binário |
|---|---|---|---|
| imm[11:0] | 31-20 | 8 | 000000001000 |
| rs1 | 19-15 | x6 | 00110 |
| funct3 | 14-12 | 010 (load de palavra) | 010 |
| rd | 11-7 | x5 | 00101 |
| opcode | 6-0 | load | 0000011 |

Concatenando: `000000001000 00110 010 00101 0000011` → `00000000100000110010001010000011` → agrupado em nibbles hex: `0000 0000 1000 0011 0010 0010 1000 0011` = `0x00832283`, batendo com a codificação de referência.

### Exemplo 3: calculando um endereço efetivo e um alvo de desvio

**Endereço efetivo base+deslocamento.** Suponha que o registrador `x6` guarde o valor 1000 (um endereço em bytes). Executar `lw x5, 8(x6)` calcula seu endereço efetivo como:

```
endereco_efetivo = x6 + imm = 1000 + 8 = 1008
```

A CPU lê os 4 bytes no endereço 1008 para `x5`. O mesmo cálculo, com os mesmos campos, produz o endereço de destino de `sw x5, 8(x6)`; só a direção do movimento dos dados muda, a aritmética de endereço é idêntica.

**Alvo de desvio relativo ao PC.** Suponha que a instrução `beq` esteja no endereço 100, e que seu imediato tipo B (já remontado e com extensão de sinal) decodifique para -4. O alvo do desvio é:

```
alvo = PC + deslocamento = 100 + (-4) = 96
```

Se a condição do desvio (`x_rs1 == x_rs2`) for verdadeira, a próxima instrução buscada vem do endereço 96, em vez do endereço sequencial 104; se for falsa, a execução segue para 104. É por isso que o deslocamento precisa ser somado ao PC atual, e não tratado como endereço absoluto: a mesma instrução, colocada num endereço diferente, ainda desviaria 4 bytes para trás, porque "4 bytes para trás" é o que o deslocamento codificado significa.

## Equívocos Comuns e Armadilhas

- **"Toda instrução RISC-V tem o mesmo leiaute de campos."** Não tem: só o campo do opcode, bits `[6:0]`, fica na mesma posição em todos os formatos. R, I, S e B recortam os 25 bits restantes de forma diferente conforme os operandos de que aquela família precisa.
- **"Os bits do imediato do tipo B são guardados numa ordem embaralhada aleatória, sem motivo."** A reordenação é deliberada: ela mantém o bit de sinal no bit 31 e outros bits nas mesmas posições usadas pelo tipo S, para que o mesmo circuito de extensão de sinal e deslocamento sirva aos imediatos dos tipos I, S e B com o mínimo de multiplexação extra.
- **"Um deslocamento de desvio de, digamos, 8 significa saltar 8 instruções."** Significa saltar 8 bytes; como toda instrução aqui tem 4 bytes, um deslocamento de 8 pula exatamente 2 instruções. Confundir deslocamentos em bytes com contagens de instruções é uma fonte comum de erros por um fator de 4.
- **"Instruções de store têm um registrador de destino (`rd`) como os loads."** Não têm: o `sw` escreve na memória, então o tipo S não tem campo `rd`; as posições de bits onde o `rd` fica nos tipos R ou I guardam, em vez disso, parte do imediato.
- **"O funct3 sozinho é sempre suficiente para identificar uma operação tipo R."** Nem sempre: `add` e `sub` compartilham o opcode `0110011` e o funct3 `000`; só o funct7 (`0000000` versus `0100000`) os distingue. Uma lógica de decodificação que ignore o funct7 vai confundi-los.
- **"Os endereçamentos relativo ao PC e base+deslocamento são a mesma coisa, porque ambos somam um deslocamento a algo."** Eles usam valores base diferentes: o base+deslocamento (`lw`/`sw`) soma um deslocamento a um registrador de propósito geral para calcular um endereço de dados, enquanto o endereçamento relativo ao PC (`beq`) o soma ao contador de programa para calcular um endereço de código, tornando os alvos de desvio independentes de onde o programa é carregado.

## Resumo

Como uma largura de instrução fixa de 32 bits ainda precisa expressar listas de operandos tão diferentes quanto "três registradores" (tipo R), "dois registradores mais uma constante de 12 bits" (tipo I), "dois registradores mais uma constante, sem destino" (tipo S) e "dois registradores mais um deslocamento de desvio com sinal e sempre par" (tipo B), o RV32I define exatamente esses quatro formatos, cada um recortando os mesmos 32 bits de forma diferente, mas mantendo campos compartilhados como `opcode`, `rs1`, `rs2` e `funct3` em posições idênticas sempre que possível, para simplificar o hardware de decodificação. O opcode estreita uma instrução até uma família, e o funct3 (e, no tipo R, o funct7) estreita mais até a operação exata, sendo `add` e `sub` o exemplo canônico de operações distinguidas só pelo funct7. Os imediatos são empacotados de forma contígua no tipo I, mas divididos no tipo S e ainda reordenados no tipo B, puramente para que o bit de sinal e outros bits fiquem em posições fixas compartilhadas entre formatos: uma economia real de fiação, não uma escolha arbitrária. Sobre esses formatos ficam os quatro modos de endereçamento desta ISA: por registrador (operandos do tipo R), imediato (a constante do `addi`), base+deslocamento (o endereço efetivo `rs1 + deslocamento` de `lw`/`sw`) e relativo ao PC (o alvo de desvio `PC + deslocamento` do `beq`). O próximo conceito, tradução de assembly para código de máquina, se constrói diretamente sobre esses formatos para mostrar como o assembly é convertido mecanicamente nos padrões de 32 bits trabalhados aqui.

## Documentation Links

- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): a referência principal para os formatos de instrução R/I/S/B do RISC-V, os leiautes de campos e o esquema de codificação de imediatos usado ao longo deste conceito.
- [ACM/IEEE CS2013: Architecture and Organization Knowledge Area](https://csed.acm.org/knowledge-areas-architecture-and-organization-ar-cs2013-version/): diretrizes curriculares que cobrem formatos de instrução e modos de endereçamento como tópicos centrais de Arquitetura e Organização.
