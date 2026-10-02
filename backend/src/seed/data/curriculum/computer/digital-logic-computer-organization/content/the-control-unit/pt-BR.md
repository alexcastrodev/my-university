---
version: 1.0
updatedAt: 2026-09-06
title: A Unidade de Controle
summary: "Uma máquina de estados finitos, construída exatamente com as ideias de circuito sequencial já vistas, que lê o opcode de uma instrução e configura cada multiplexador e linha de controle do datapath para fazer aquela instrução específica acontecer."
---
## Objetivos de Aprendizagem

- Explicar o trabalho da unidade de controle como produzir cada sinal de controle de que o datapath precisa (RegWrite, ALUSrc, MemRead, MemWrite, MemToReg, Branch e ALUControl) a partir do opcode de uma instrução (e, quando necessário, do funct3 e do funct7).
- Explicar por que, especificamente numa CPU monociclo, a unidade de controle é lógica puramente combinacional (uma tabela verdade), e não uma máquina de estados finitos genuína com vários estados.
- Construir e ler uma tabela de sinais de controle que lista os valores corretos dos sinais para instruções tipo R, `addi`, `lw`, `sw` e `beq`.
- Derivar o `PCSrc` como o AND lógico de `Branch` com a flag `Zero` da ULA, e explicar por que os dois são necessários.
- Acompanhar, para uma instrução específica, exatamente como seu opcode (e o funct3/funct7, quando relevantes) determina o valor de cada sinal de controle.

## Contexto e Motivação

O conceito anterior construiu o datapath monociclo: uma rede fixa de barramentos, um banco de registradores, uma ULA, uma memória de dados e três multiplexadores (ALUSrc, MemToReg (WBSel) e PCSrc), cada um sempre com seus dois valores candidatos prontos, em todo ciclo, para toda instrução. Aquele conceito deixou a linha de seleção de cada mux e cada linha de habilitação sem ligação a nada significativo. A **unidade de controle** fecha essa lacuna: ela lê a instrução que está no datapath (especificamente seu opcode e, nas instruções tipo R, também o funct3 e o funct7) e produz a combinação exata de valores de sinais que faz o datapath fixo executar corretamente aquela instrução.

Isso também resolve uma pergunta que o conceito anterior de "Máquinas de Estados Finitos" deveria levantar: a unidade de controle é uma FSM? O *Digital Design and Computer Architecture* de Harris & Harris e o "Building the Beta" do MIT 6.004 tratam disso diretamente. Em geral, a lógica de controle sequencia naturalmente uma instrução pelas etapas de busca, decodificação, execução e write-back, e por isso é modelada como uma FSM que lembra em que etapa está. Mas no projeto monociclo construído ao longo desta disciplina, toda instrução, seja qual for o tipo, termina inteiramente dentro de um ciclo de clock: busca, leitura de registradores, cálculo na ULA, acesso à memória e write-back acontecem todos de forma combinacional na mesma batida, com só o banco de registradores e o PC mudando de estado, e só no finalzinho. Como nunca há mais que um "estado" implícito (uma decisão nova é tomada a cada ciclo, sem precisar de memória do anterior), esta unidade de controle não tem estado interno nenhum. Ela degenera de uma máquina de estados geral num decodificador puramente combinacional: uma tabela verdade que mapeia bits do opcode diretamente em bits de sinais de saída. Mais adiante, na disciplina de Arquitetura de Computadores, as CPUs multiciclo e com pipeline reintroduzem FSMs de controle genuínas, com estado interno real, porque esses projetos espalham o trabalho de uma instrução por mais de um ciclo de clock e precisam lembrar em que ponto dessa sequência estão.

## Teoria Central

### O que a unidade de controle lê

As únicas entradas da unidade de controle são bits que já estão na instrução buscada: o `opcode` de 7 bits (bits [6:0] em todo formato) e, especificamente nas instruções tipo R, o `funct3` de 3 bits e o `funct7` de 7 bits, necessários porque várias operações tipo R (`add` e `sub`, principalmente) compartilham opcode e funct3 idênticos e só se distinguem pelo funct7. A unidade de controle nunca lê conteúdo de registradores, conteúdo de memória nem o resultado numérico da ULA, com uma única exceção estreita descrita abaixo (a flag `Zero`, usada só para o `PCSrc`). Toda outra saída é função pura da codificação estática da instrução, decidida no instante em que a instrução é buscada, antes de qualquer registrador ser lido ou de qualquer cálculo na ULA acontecer.

### Os sinais de controle de que este datapath precisa

Cada sinal abaixo corresponde a exatamente uma linha de seleção ou de habilitação deixada solta no datapath do conceito anterior:

- **RegWrite**: habilita a porta de escrita do banco de registradores. Ativado nas instruções que escrevem um resultado de volta num registrador de destino (tipo R, `addi`, `lw`); desativado onde não há registrador de destino (`sw`, `beq`).
- **ALUSrc**: seleciona o segundo operando da ULA: 0 encaminha o valor do registrador `rs2`; 1 encaminha o imediato com extensão de sinal.
- **ALUControl**: seleciona qual operação da ULA roda neste ciclo (soma, subtração, AND, OR, SLT), derivado só do opcode na maioria das instruções, mas do opcode, do funct3 *e* do funct7 juntos no tipo R.
- **MemRead**: habilita a porta de leitura da memória de dados. Ativado só no `lw`.
- **MemWrite**: habilita a porta de escrita da memória de dados. Ativado só no `sw`.
- **MemToReg** (equivalente a **WBSel**): seleciona o valor de write-back: 0 seleciona o resultado da ULA, 1 seleciona o dado lido da memória de dados. É um "don't care" sempre que `RegWrite` vale 0.
- **Branch**: ativado só no `beq`, sinalizando "a decisão de PC desta instrução depende da flag Zero da ULA", independentemente do valor real dessa flag.
- **PCSrc**: não é produzido diretamente pela tabela de opcodes, mas calculado mais adiante como `Branch AND Zero`, e é esse sinal, e não o `Branch` sozinho, que comanda o mux PCSrc construído antes.

### A tabela de sinais de controle

| Tipo de instrução | opcode | RegWrite | ALUSrc | MemRead | MemWrite | MemToReg (WBSel) | Branch | ALUControl |
|---|---|---|---|---|---|---|---|---|
| Tipo R (`add`/`sub`/`and`/`or`/`slt`) | 0110011 | 1 | 0 (registrador) | 0 | 0 | 0 (resultado da ULA) | 0 | funct3+funct7 selecionam ADD/SUB/AND/OR/SLT |
| `addi` | 0010011 | 1 | 1 (imediato) | 0 | 0 | 0 (resultado da ULA) | 0 | ADD |
| `lw` | 0000011 | 1 | 1 (imediato) | 1 | 0 | 1 (dado da memória) | 0 | ADD |
| `sw` | 0100011 | 0 | 1 (imediato) | 0 | 1 | X (don't care) | 0 | ADD |
| `beq` | 1100011 | 0 | 0 (registrador) | 0 | 0 | X (don't care) | 1 | SUB |

Cada linha é uma resposta fixa e incondicional a um valor fixo de opcode, e é exatamente isso que torna a unidade de controle puramente combinacional: implementável como lógica de decodificação comum (uma rede AND/OR por sinal de saída), sem memória de ciclos anteriores.

### ALUControl em mais detalhe: quando funct3 e funct7 importam

Para toda instrução exceto as do tipo R, o `ALUControl` é função direta só do opcode: `addi`, `lw`, `sw` precisam todas de soma comum, então o opcode sozinho seleciona ADD; o `beq` sempre precisa de subtração, então o opcode sozinho seleciona SUB. O tipo R é o único caso em que o opcode sozinho é insuficiente, porque um único opcode (0110011) é compartilhado por `add`, `sub`, `and`, `or` e `slt`. A unidade de controle resolve isso alimentando o funct3 e o funct7 na lógica de decodificação do ALUControl especificamente para o tipo R: funct3 = 000 com funct7 = 0000000 seleciona ADD, funct3 = 000 com funct7 = 0100000 seleciona SUB, funct3 = 111 seleciona AND, funct3 = 110 seleciona OR, e funct3 = 010 seleciona SLT. Nenhum outro tipo de instrução precisa consultar o funct3 ou o funct7.

### PCSrc = Branch AND Zero

`Branch` e `Zero` vêm de hardware totalmente diferente (`Branch` da decodificação do opcode na unidade de controle, puramente estático; `Zero` da ULA, calculado dinamicamente a partir dos valores reais dos registradores neste ciclo), e `PCSrc = Branch AND Zero`. As duas entradas são genuinamente necessárias. O `Branch` sozinho é insuficiente porque o `Zero` pode ser ativado por motivos que não têm nada a ver com desvio: uma subtração tipo R que por acaso dá zero também ativa o Zero, puramente como efeito colateral. Se o `PCSrc` fosse ligado só ao `Zero`, `sub x5, x6, x6` (sempre zero) redirecionaria o PC incorretamente, mesmo sem nenhum desvio em execução; o `Branch` bloqueia isso, forçando `PCSrc = 0` sempre que `Branch = 0`, seja qual for o `Zero`. O `Zero` sozinho é igualmente insuficiente: a semântica do `beq` é "desvia só se forem iguais", e a igualdade é exatamente o que o Zero informa quando o ALUControl está em SUB (rs1 − rs2 = 0 se e somente se rs1 = rs2); sem consultar o Zero, o desvio nunca poderia ser condicional. Depois de calculado, `PCSrc = 0` seleciona PC + 4 no mux PCSrc, e `PCSrc = 1` seleciona PC + deslocamento. Em toda instrução que não é desvio, `Branch = 0` força `PCSrc = 0` incondicionalmente, então o PC sempre simplesmente avança 4.

### Por que esta unidade de controle não tem estados: um decodificador, não uma FSM

Uma FSM, como vista antes nesta disciplina, é definida por estados, uma função de próximo estado e uma função de saída que pode depender do estado atual. Esta unidade de controle tem exatamente um "estado" implícito (decodificar o opcode desta instrução) que nunca depende da instrução anterior. Sua saída depende só dos bits da instrução atual, sem função de próximo estado levando nada adiante; as saídas de cada ciclo são calculadas do zero, exatamente como uma tabela de consulta somente leitura. Isso é consequência direta do projeto monociclo: como toda instrução termina por completo dentro de um ciclo de clock, a unidade de controle nunca precisa lembrar que está no meio de um `lw` ou no meio de um `add`; na próxima borda, a instrução anterior já terminou inteiramente. Os projetos multiciclo, que espalham a busca, a decodificação, o acesso à memória e o write-back de uma instrução por vários ciclos para permitir um clock mais lento e o reaproveitamento de hardware, e os projetos com pipeline, que sobrepõem a execução parcial de várias instruções ao mesmo tempo, precisam ambos genuinamente de uma unidade de controle com estado interno real, porque "qual parte de qual instrução está acontecendo agora" deixa de ser decidível só pelos bits da instrução atual. Essa distinção pertence à disciplina de Arquitetura de Computadores; dentro desta CPU monociclo, a visão de decodificador combinacional é completamente precisa.

## Exemplos Resolvidos

### Exemplo 1: derivando a linha de sinais de controle de uma instrução tipo R

Objetivo: derivar cada sinal de `add x5, x6, x7` (opcode 0110011, funct3 000, funct7 0000000). O opcode identifica uma instrução de ULA tipo R. RegWrite = 1, já que o tipo R sempre escreve um resultado em `rd`. ALUSrc = 0, já que o tipo R não carrega campo de imediato nenhum (todo bit é gasto com registradores e códigos de função), então o segundo operando da ULA precisa ser um valor de registrador. MemRead = MemWrite = 0, já que a memória de dados nunca é tocada. MemToReg = 0, já que o valor de write-back é a soma da ULA, não dado da memória. Branch = 0, então PCSrc = Branch AND Zero = 0, seja qual for a flag Zero da ULA neste ciclo. ALUControl: como o opcode é tipo R, o funct3 e o funct7 precisam ambos ser consultados; funct3 = 000 com funct7 = 0000000 seleciona ADD (contra funct7 = 0100000, que selecionaria SUB com o mesmo funct3, distinguindo `add` de `sub`). A linha resultante bate com a linha do tipo R na tabela acima.

### Exemplo 2: derivando e contrastando as linhas de `lw` e `sw`

**`lw x5, 8(x6)`** (opcode 0000011): RegWrite = 1, já que a palavra carregada é escrita em `rd`. ALUSrc = 1, já que a ULA precisa somar `rs1` ao imediato com extensão de sinal para calcular o endereço efetivo, e não somar dois registradores. MemRead = 1, já que o propósito desta instrução é ler a memória no endereço calculado. MemWrite = 0. MemToReg = 1, já que o valor escrito de volta precisa ser a saída da memória de dados, e não o próprio cálculo de endereço da ULA. Branch = 0. ALUControl = ADD.

**`sw x5, 8(x6)`** (opcode 0100011): RegWrite = 0, já que o formato tipo S não tem campo `rd` (esses bits guardam parte do imediato), então não há registrador de destino. ALUSrc = 1, pelo mesmo raciocínio do `lw`: a mesma aritmética de endereço base mais deslocamento. MemRead = 0. MemWrite = 1, já que o propósito desta instrução é escrever o valor de `rs2` na memória no endereço calculado. MemToReg = don't care, já que RegWrite = 0 já garante que nada é escrito de volta. Branch = 0. ALUControl = ADD, exatamente como no `lw`.

**Contraste:** ALUSrc e ALUControl são idênticos porque os dois calculam a mesma aritmética de endereço a partir do mesmo leiaute de campos. O RegWrite vira de 1 para 0 porque um load produz um resultado num registrador de destino, enquanto um store não. MemRead e MemWrite são exatamente opostos, refletindo dados que se movem em direções opostas. O MemToReg vale 1 de forma significativa no `lw`, mas é simplesmente irrelevante no `sw`, já que o RegWrite já garante que nenhuma saída do mux de write-back seja capturada.

### Exemplo 3: derivando a linha do `beq` e explicando a decisão de tomado/não tomado

`beq x5, x6, offset` (opcode 1100011): RegWrite = 0, já que o `beq` não produz resultado em registrador; assim como no `sw`, o formato tipo B não tem campo `rd`. ALUSrc = 0, já que o `beq` compara dois valores de registrador diretamente (`rs1` contra `rs2`); o deslocamento é usado separadamente, pelo somador do alvo de desvio, e não pela ULA. MemRead = MemWrite = 0. MemToReg = don't care, exatamente como no `sw`. Branch = 1: o único tipo de instrução nesta ISA que o ativa, sinalizando "a decisão de próximo PC desta instrução depende do Zero". ALUControl = SUB, para que a ULA calcule `rs1 − rs2` e sua flag Zero informe se os dois operandos são iguais.

A decisão de tomado/não tomado em si acontece mais adiante, por meio de `PCSrc = Branch AND Zero`. Como aqui Branch = 1, o PCSrc se reduz simplesmente à flag Zero da ULA: se `rs1` e `rs2` guardam valores iguais, Zero = 1, então PCSrc = 1, e o mux PCSrc seleciona o PC + deslocamento do somador do alvo de desvio, redirecionando a execução. Se forem diferentes, Zero = 0, então PCSrc = 0 apesar de o Branch estar ativado, e a execução segue para PC + 4. A única responsabilidade da unidade de controle é garantir Branch = 1 e ALUControl = SUB para o `beq`; o resultado real de tomado/não tomado é decidido dinamicamente, a cada execução, só pela flag Zero da ULA.

## Equívocos Comuns e Armadilhas

- **"A unidade de controle lê conteúdo de registradores ou de memória para decidir."** Não lê, com a única exceção da flag Zero da ULA alimentando o PCSrc. Todo sinal da tabela acima é função pura dos bits estáticos da instrução, decidida antes de qualquer registrador ser lido.
- **"A unidade de controle é sempre uma FSM genuína com vários estados."** Neste projeto monociclo, não é: toda instrução termina num ciclo, então a unidade de controle não precisa de memória de ciclos anteriores e degenera em lógica de decodificação combinacional. As CPUs multiciclo e com pipeline, vistas mais adiante, de fato exigem FSMs de controle genuínas.
- **"O Branch sozinho basta para redirecionar o PC."** Não basta: o `Branch` só sinaliza "esta decisão depende do Zero"; o redirecionamento só acontece quando `Branch AND Zero` vale 1. Uma subtração tipo R que por acaso dá zero nunca deve redirecionar o PC, e é por isso que o `Branch` precisa bloquear o `Zero`, e não ser substituído por ele.
- **"O funct3 sozinho sempre determina o ALUControl no tipo R."** Não em todos os casos: `add` e `sub` compartilham opcode e funct3 e só se distinguem pelo funct7. Ignorar o funct7 no tipo R não consegue diferenciá-los.
- **"Um sinal 'don't care' é eletricamente indefinido."** Significa que o valor não pode afetar a correção, e não que nada sai: o mux continua produzindo algo em todo ciclo no `sw` e no `beq`, só que isso nunca é capturado, porque RegWrite = 0.
- **"Toda instrução precisa de uma combinação totalmente distinta dos sete sinais."** Várias compartilham valores: `addi`, `lw` e `sw` compartilham ALUSrc = 1 e ALUControl = ADD, já que compartilham a mesma necessidade subjacente de calcular rs1 mais um imediato.

## Resumo

A unidade de controle é o decodificador combinacional que lê o opcode de uma instrução (e, no tipo R, seu funct3 e funct7) e produz cada sinal de controle de que o datapath monociclo precisa (RegWrite, ALUSrc, ALUControl, MemRead, MemWrite, MemToReg e Branch), transformando as linhas soltas de seleção e de habilitação do datapath numa instrução executada corretamente. Como toda instrução termina dentro de exatamente um ciclo de clock, a unidade de controle não precisa de memória de ciclos anteriores, então ela degenera do modelo geral de máquina de estados finitos numa tabela verdade pura de bits de instrução para sinais de saída, uma simplificação específica dos projetos monociclo que as unidades de controle multiciclo e com pipeline, vistas mais adiante em Arquitetura de Computadores, não podem fazer. A tabela de sinais de controle mostra `lw` e `sw` compartilhando os sinais de cálculo de endereço e divergindo em RegWrite, MemRead e MemWrite, e mostra o `beq` ativando de forma única o Branch e selecionando SUB, para que a flag Zero da ULA, calculada dinamicamente, combinada por AND com o sinal Branch decodificado estaticamente, decida com segurança se o PC é redirecionado ou simplesmente avança 4. Com o datapath e seu controle totalmente especificados, o próximo conceito os monta no ciclo completo de busca, decodificação e execução que se repete a cada batida do clock.

## Documentation Links

- [MIT 6.004: Building the Beta](https://computationstructures.org/lectures/beta/beta.html): uma derivação completa e resolvida do conjunto de sinais de uma unidade de controle monociclo a partir dos campos de opcode de uma instrução, usando a mesma metodologia de decodificar e comandar o datapath vista neste conceito.
- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): a referência principal para a unidade de controle RISC-V monociclo, sua tabela de sinais de controle e a decisão PCSrc = Branch AND Zero vistas ao longo deste conceito.
