---
version: 1.0
updatedAt: 2026-09-06
title: Tradução de Assembly para Código de Máquina
summary: "Traduzir uma instrução assembly legível por humanos no padrão exato de bits que uma CPU de fato busca e decodifica: o processo mecânico, um para um, que um montador automatiza."
---
## Objetivos de Aprendizagem

- Descrever a tradução de assembly para código de máquina como um processo mecânico e um para um: consultar os campos opcode/funct do mnemônico, converter nomes de registradores em números de 5 bits, converter o imediato no seu campo binário (possivelmente dividido) e concatenar o resultado numa palavra de 32 bits.
- Traduzir um nome de registrador (por exemplo, `x6`) no seu número binário de 5 bits correto, e explicar por que 5 bits são exatamente suficientes para 32 registradores.
- Converter um imediato decimal no seu campo binário em complemento de dois com o tamanho certo, incluindo dividi-lo entre posições de bits não adjacentes quando o formato de destino (tipo S ou tipo B) exigir.
- Explicar o algoritmo do montador de duas passagens (construir uma tabela de símbolos com os endereços dos rótulos na primeira passagem, e depois resolver os deslocamentos de desvio na segunda) e por que os endereços dos rótulos nem sempre podem ser resolvidos numa única passagem.
- Inverter o processo de tradução (desmontagem): dada uma palavra de máquina de 32 bits, recuperar os campos opcode/funct, os números dos registradores e o imediato, e reconstruir o mnemônico assembly original.

## Contexto e Motivação

O conceito anterior desta disciplina estabeleceu exatamente como os 32 bits do RV32I são recortados em formatos de instrução (R, I, S e B), com fronteiras fixas de campo para opcode, funct3, funct7, números de registradores e imediatos. Aquele conceito respondeu "o que cada posição de bit significa". Este conceito responde a pergunta seguinte: dada uma linha de assembly legível como `add x5, x6, x7`, como esse texto vira o padrão específico de 32 bits `0x007302B3` que uma CPU de fato busca na memória? A resposta, talvez surpreendente dado o quanto os montadores são centrais na programação de sistemas, é que a tradução é inteiramente mecânica: não há criatividade, não há ambiguidade, e não há necessidade de nada parecido com a complexidade de análise sintática de um compilador de linguagem de propósito geral. Todo mnemônico corresponde a exatamente uma combinação de opcode/funct3/funct7, todo nome de registrador corresponde a exatamente um número de 5 bits, e todo imediato corresponde a exatamente um campo binário (possivelmente dividido entre faixas de bits não adjacentes, como o conceito anterior mostrou para os tipos S e B). Um montador é, no fundo, uma máquina de consultar e concatenar, não um intérprete de significado.

Essa natureza mecânica importa por um motivo bem concreto: é ela que torna um montador confiável e previsível. Um programador ou compilador que emite `addi x5, x6, 10` pode ter certeza absoluta de que a palavra de máquina resultante vai ser `0x00A30293` toda vez, em todo processador compatível com RV32I, porque o mapeamento de mnemônico mais operandos para padrão de bits é fixado pela especificação da ISA, e não deixado a critério do montador, como, por exemplo, a alocação de registradores é deixada a critério de um compilador. A única complicação genuína num processo de resto totalmente mecânico é o tratamento de rótulos simbólicos usados por instruções de desvio: um programador escreve `beq x5, x6, loop`, nomeando um alvo por um rótulo legível em vez de por um deslocamento bruto em bytes, e o montador precisa primeiro descobrir a que endereço `loop` se refere antes de poder calcular o deslocamento numérico que de fato é codificado. É por isso que montadores reais, incluindo o descrito implicitamente no tratamento da cadeia de ferramentas RISC-V de Harris & Harris e no tratamento mais amplo de tradução e ligação do MIT 6.004, trabalham em duas passagens, e não em uma. Entender esse processo de tradução nos dois sentidos (montar texto em bits e desmontar bits de volta em texto) é base essencial para os conceitos de datapath e unidade de controle que vêm a seguir, já que esses conceitos tratam precisamente do hardware que faz a metade de decodificação desta mesma correspondência, automaticamente e num único ciclo de clock, toda vez que uma instrução é buscada.

## Teoria Central

### A receita mecânica de tradução

Montar qualquer instrução isolada (ignorando, por enquanto, os rótulos simbólicos) segue exatamente a mesma receita de quatro passos, qualquer que seja o formato usado pela instrução:

1. **Consultar o mnemônico.** O montador consulta uma tabela fixa que mapeia cada mnemônico (`add`, `addi`, `lw`, `sw`, `beq` e assim por diante) para seu formato (R, I, S ou B) e seus valores de campo fixos: sempre o opcode, sempre o funct3, e o funct7 nas instruções tipo R que precisam dele.
2. **Converter nomes de registradores em números.** Cada operando registrador, escrito como um nome do tipo `x5` ou `x6`, é convertido no seu número de registrador binário de 5 bits: `x5` vira `00101`, `x6` vira `00110`, e assim por diante, simplesmente pegando o sufixo numérico e escrevendo-o em 5 bits (os registradores são numerados de x0 a x31, e `2^5 = 32` é exatamente o suficiente para numerar todos eles sem desperdiçar espaço de codificação).
3. **Converter o imediato.** Qualquer operando numérico (uma constante de `addi`, um deslocamento de load/store ou a distância até um alvo de desvio) é convertido da sua forma decimal (ou hexadecimal) no código-fonte num campo binário de largura fixa em complemento de dois. No tipo I esse campo tem 12 bits contíguos; nos tipos S e B, como o conceito anterior detalhou, o imediato precisa ser dividido (e, no tipo B, reordenado) entre duas ou mais faixas de bits não adjacentes ditadas pelo formato.
4. **Concatenar.** Os campos fixos do passo 1 e os campos convertidos dos passos 2 e 3 são colocados nas posições de bits exigidas pelo formato e concatenados, do bit mais significativo para o menos, numa palavra de 32 bits.

Toda instrução RV32I, não importa como ela se lê em assembly, é produzida por este mesmo procedimento de quatro passos; a única coisa que varia entre instruções é qual leiaute de campos de formato é usado no passo 4.

### Rótulos simbólicos e o montador de duas passagens

A receita acima supõe que todo operando já é um número concreto. Mas as instruções de desvio em programas assembly reais quase sempre nomeiam seus alvos com um rótulo, e não com um deslocamento bruto:

```
      addi x5, x0, 0
loop: addi x5, x5, 1
      addi x6, x6, -1
      beq  x6, x0, done
      beq  x0, x0, loop
done: addi x7, x0, 1
```

Quando o montador chega à linha `beq x6, x0, done`, ele precisa codificar um deslocamento em bytes do endereço da própria instrução até o endereço rotulado `done`; mas, no momento em que lê essa linha, numa única passagem ingênua da esquerda para a direita, o montador pode ainda não saber onde `done` está (ele aparece mais adiante no arquivo), e até o endereço da instrução atual depende de quantos bytes cada instrução anterior ocupou. É por isso que os montadores, incluindo as convenções de cadeia de ferramentas descritas em Harris & Harris e no material de tradução do MIT 6.004, usam duas passagens:

- **Passagem 1 (construir a tabela de símbolos):** o montador percorre o programa inteiro de cima a baixo sem emitir nenhum código de máquina ainda, mantendo um contador de endereço (começando em algum endereço base e somando 4 a cada instrução, já que toda instrução RV32I tem exatamente 4 bytes). Sempre que encontra a definição de um rótulo (um nome seguido de dois-pontos, como `loop:` ou `done:`), ele registra numa tabela de símbolos o nome do rótulo junto com o endereço que a próxima instrução vai ocupar.
- **Passagem 2 (resolver e emitir):** o montador percorre o programa uma segunda vez e, desta vez, aplica de fato a receita de tradução de quatro passos a cada instrução. Sempre que encontra um rótulo usado como operando (como `done` em `beq x6, x0, done`), ele procura o rótulo na tabela de símbolos construída na passagem 1, calcula o deslocamento do desvio como `(endereço do alvo) - (endereço desta instrução de desvio)`, e codifica esse deslocamento calculado no campo de imediato do tipo B exatamente como codificaria qualquer outro imediato numérico.

As duas passagens são necessárias especificamente porque um rótulo pode ser usado antes de ser definido (uma "referência à frente", como `done` acima): não há como saber o endereço de um rótulo ainda não visto sem antes percorrer o programa inteiro para construir a tabela de símbolos completa, que é exatamente o que a passagem 1 faz antes de a passagem 2 precisar dessa informação.

### Desmontagem: rodando a receita ao contrário

A desmontagem inverte a receita de tradução exatamente, campo a campo:

1. Extrair os bits `[6:0]` como o opcode, e usá-lo para determinar o formato da instrução (R, I, S ou B) e estreitar a família da instrução.
2. Extrair o `funct3` dos bits `[14:12]` (e, se o formato for tipo R, o `funct7` dos bits `[31:25]`) para fixar o mnemônico exato.
3. Extrair os campos de registrador (`rd`, `rs1`, `rs2`, os que o formato tiver) das suas posições de bits fixas e converter cada número de 5 bits de volta num nome de registrador (`00101` vira `x5`).
4. Extrair o(s) campo(s) de imediato, remontando quaisquer pedaços divididos ou reordenados (tipos S e B) num único valor binário, e então interpretar esse valor como um número com sinal em complemento de dois.
5. Remontar as peças em texto de linguagem assembly, na ordem padrão de operandos do mnemônico.

Como cada um desses mapeamentos é uma consulta fixa, guiada por tabela, sem ambiguidade em nenhum dos sentidos, a desmontagem é exatamente tão mecânica quanto a montagem, uma propriedade essencial para depuradores e ferramentas de desmontagem, que precisam recuperar um significado exato e sem ambiguidade, em nível de código-fonte, a partir do conteúdo bruto da memória.

## Exemplos Resolvidos

### Exemplo 1: montando `add x5, x6, x7` passo a passo, até 0x007302B3

**Passo 1: consultar o mnemônico.** `add` é tipo R, com opcode `0110011`, funct3 `000`, funct7 `0000000`.

**Passo 2: converter os registradores.** `rd = x5 = 00101`, `rs1 = x6 = 00110`, `rs2 = x7 = 00111`.

**Passo 3: converter o imediato.** Nenhum, já que o tipo R não carrega imediato.

**Passo 4: concatenar**, usando a ordem de campos do tipo R `funct7 | rs2 | rs1 | funct3 | rd | opcode`:

```
funct7   rs2   rs1   funct3  rd    opcode
0000000  00111 00110 000     00101 0110011
```

Concatenado sem espaços: `00000000111001100000010100110011`. Reagrupando em nibbles a partir da esquerda (32 bits = 8 dígitos hexadecimais):

```
0000 0000 0111 0011 0000 0010 1011 0011
 0    0    7    3    0    2    B    3
```

Resultado: `0x007302B3`, exatamente a codificação de referência de `add x5, x6, x7`.

### Exemplo 2: montando `addi x5, x6, 10` passo a passo, até 0x00A30293

**Passo 1: consultar o mnemônico.** `addi` é tipo I, com opcode `0010011`, funct3 `000`.

**Passo 2: converter os registradores.** `rd = x5 = 00101`, `rs1 = x6 = 00110`.

**Passo 3: converter o imediato.** A constante decimal `10` precisa virar um campo de 12 bits em complemento de dois. Como 10 é positivo, isso é simplesmente 10 escrito em 12 bits: `10 = 8 + 2 = 0000 0000 1010` em binário, ou seja, `000000001010`. (Se a constante fosse negativa, por exemplo -10, a negação padrão em complemento de dois, inverter os bits de 10 e somar 1, seria aplicada dentro do campo de 12 bits antes de seguir; aqui nenhuma negação é necessária.)

**Passo 4: concatenar**, usando a ordem de campos do tipo I `imm[11:0] | rs1 | funct3 | rd | opcode`:

```
imm[11:0]     rs1   funct3  rd    opcode
000000001010  00110 000     00101 0010011
```

Concatenado: `00000000101000110000001010010011`. Reagrupando em nibbles:

```
0000 0000 1010 0011 0000 0010 1001 0011
 0    0    A    3    0    2    9    3
```

Resultado: `0x00A30293`, exatamente a codificação de referência de `addi x5, x6, 10`.

### Exemplo 3: montando `sw x5, 8(x6)` passo a passo, até 0x00532423

**Passo 1: consultar o mnemônico.** `sw` é tipo S, com opcode `0100011`, funct3 `010`.

**Passo 2: converter os registradores.** Num store, `rs1` é o registrador de endereço base e `rs2` é o registrador que guarda o valor sendo armazenado: `rs1 = x6 = 00110`, `rs2 = x5 = 00101`. (Não há `rd` no tipo S.)

**Passo 3: converter o imediato e dividi-lo.** O deslocamento `8` como valor de 12 bits em complemento de dois é `000000001000`. O tipo S exige que esse campo de 12 bits seja dividido em dois pedaços que ocupam faixas de bits não adjacentes: os 7 bits altos, `imm[11:5]`, e os 5 bits baixos, `imm[4:0]`.

```
imediato de 12 bits: 0000 0000 1000
posições de bit:     11 10 9 8 7 6 5 4 3 2 1 0
                      0  0 0 0 0 0 0 1 0 0 0 0
imm[11:5] (7 bits, do bit 11 ao 5): 0000000
imm[4:0]  (5 bits, do bit 4 ao 0):  01000
```

**Passo 4: concatenar**, usando a ordem de campos do tipo S `imm[11:5] | rs2 | rs1 | funct3 | imm[4:0] | opcode`:

```
imm[11:5]  rs2   rs1   funct3  imm[4:0]  opcode
0000000    00101 00110 010     01000     0100011
```

Concatenado sem espaços: `00000000010100110010010000100011`. Reagrupando em nibbles a partir da esquerda:

```
0000 0000 0101 0011 0010 0100 0010 0011
 0    0    5    3    2    4    2    3
```

Resultado: `0x00532423`, exatamente a codificação de referência de `sw x5, 8(x6)`. Repare que remontar os dois pedaços do imediato num único valor de 12 bits (`imm[11:5]` concatenado com `imm[4:0]`, ou seja, `0000000` seguido de `01000`, dando `000000001000` = 8) recupera exatamente o deslocamento original, confirmando que a divisão não perdeu nada.

## Equívocos Comuns e Armadilhas

- **"Montar uma instrução exige entender o que o programa está tentando fazer."** Não exige: a montagem é uma tradução puramente mecânica de mnemônico e operandos para padrão de bits, com uma tabela de consulta fixa. Um montador nunca precisa raciocinar sobre a intenção de um programa; ele só precisa da tabela de mnemônicos, do leiaute de campos do formato e dos valores dos operandos, exatamente como mostrado nos exemplos resolvidos acima.
- **"Um imediato negativo é codificado simplesmente escrevendo um sinal de menos em algum lugar do padrão de bits."** Não existe um bit de sinal guardado separadamente do valor: imediatos negativos são codificados usando a representação em complemento de dois dentro do campo de imediato de largura fixa (12 bits nos tipos I e S, 13 bits remontados no tipo B), então o "sinal" é simplesmente o valor que o bit mais significativo desse campo tiver depois de feita a conversão em complemento de dois.
- **"O montador de duas passagens roda duas vezes porque está conferindo o próprio trabalho."** A segunda passagem não é uma passagem de verificação: ela é necessária porque o único trabalho da passagem 1 é descobrir os endereços dos rótulos (construindo a tabela de símbolos), e a passagem 2 não consegue calcular corretamente o deslocamento de um desvio com referência à frente, como `beq x6, x0, done`, até que essa tabela de símbolos completa já exista. Uma única passagem não consegue ao mesmo tempo descobrir o endereço de um rótulo posterior e usar esse endereço na codificação de uma instrução anterior.
- **"A desmontagem é fundamentalmente mais difícil ou menos certa que a montagem."** Com um conjunto de instruções fixo e sem ambiguidade como o RV32I, a desmontagem é exatamente tão mecânica quanto a montagem: toda combinação de opcode/funct3/funct7 corresponde de volta a exatamente um mnemônico, sem adivinhação, precisamente porque a ISA foi projetada para que duas instruções distintas nunca compartilhem um conjunto idêntico de campos de formato, opcode e funct.
- **"Dividir o imediato do tipo S ou do tipo B em pedaços muda seu valor numérico."** Não muda: dividir (e, no tipo B, reordenar) só muda onde os bits ficam fisicamente guardados dentro da palavra de 32 bits; remontar os pedaços na ordem correta, como o Exemplo 3 demonstra ao concatenar `imm[11:5]` e `imm[4:0]` de volta, sempre recupera exatamente o valor original.
- **"Os números de registradores no código de máquina são texto ASCII como 'x5'."** Não são: `x5` é puramente uma conveniência da linguagem assembly; o código de máquina só contém o número binário de 5 bits 5 (`00101`), sem nenhum vestígio da letra 'x' nem de qualquer representação textual em lugar algum da instrução codificada.

## Resumo

Traduzir uma instrução assembly no seu equivalente de 32 bits em código de máquina é um processo de quatro passos totalmente mecânico: consultar o formato e os campos fixos de opcode/funct do mnemônico, converter cada nome de registrador no seu número de 5 bits, converter cada imediato no seu campo binário de largura fixa em complemento de dois (dividindo-o e reordenando-o entre posições de bits não adjacentes exatamente quando o formato tipo S ou tipo B exigir), e concatenar cada campo na posição de bits exigida pelo formato para produzir uma palavra de 32 bits. Essa receita foi verificada campo a campo nos exemplos resolvidos deste conceito para `add`, `addi` e `sw`, cada um produzindo exatamente sua codificação hexadecimal de referência. A única complicação num processo de resto guiado por tabela são os rótulos simbólicos de desvio, que montadores reais resolvem com um algoritmo de duas passagens: a passagem 1 constrói uma tabela de símbolos com os endereços dos rótulos percorrendo o programa inteiro sem emitir código, e a passagem 2 faz a tradução de fato, calculando o deslocamento numérico de cada desvio a partir dessa tabela de símbolos já completa. A desmontagem é simplesmente essa mesma receita rodada ao contrário, extraindo campos de posição fixa e mapeando-os de volta em mnemônicos, nomes de registradores e imediatos com sinal, sem ambiguidade. Os próximos conceitos desta disciplina (o datapath e a unidade de controle) se constroem diretamente sobre essa correspondência, já que eles são o hardware que faz exatamente essa mesma decodificação, automaticamente, toda vez que uma instrução é buscada na memória.

## Documentation Links

- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): a referência principal para as regras de codificação de instruções RISC-V e as convenções de cadeia de ferramentas que a receita de tradução deste conceito segue.
- [MIT 6.004: OCW Syllabus](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/syllabus/): ementa do curso Computation Structures, cujas unidades de tradução e ligação motivam a visão mecânica e guiada por tabela da tradução de assembly para código de máquina usada neste conceito.
