---
version: 1.0
updatedAt: 2026-09-06
title: O Ciclo de Busca, Decodificação e Execução
summary: "A cada ciclo, uma CPU busca a próxima instrução, decodifica qual operação ela nomeia, executa-a pelo datapath e atualiza o contador de programa: o mesmo laço de três passos, repetido bilhões de vezes por segundo."
---
## Objetivos de Aprendizagem

- Enunciar os quatro passos do ciclo de busca, decodificação e execução (busca, decodificação, execução, atualização do PC) e explicar o que acontece com o datapath e a unidade de controle em cada passo.
- Explicar por que, numa CPU monociclo, os quatro passos acontecem dentro de um período de clock como uma única estabilização combinacional de sinais, e não como quatro batidas sequenciais do clock.
- Acompanhar um ciclo completo para uma instrução tipo R (add), uma instrução de load (lw) e um desvio tomado (beq), identificando quais sinais de controle são ativados e como o contador de programa é atualizado em cada caso.
- Explicar o papel especial do contador de programa como o único pedaço de estado que identifica "onde a máquina está" num programa em execução, e como sua regra de atualização (PC+4, ou alvo de desvio) implementa o fluxo de controle sequencial e não sequencial.
- Justificar por que o ciclo de busca, decodificação e execução, e não alguma instrução isolada, é a unidade fundamental de operação de uma CPU, repetindo-se inalterado bilhões de vezes por segundo, seja qual for o programa em execução.

## Contexto e Motivação

Todo computador de propósito geral, por mais sofisticado que seja seu conjunto de instruções, faz uma ação surpreendentemente pequena e repetitiva, sem parar, desde ser ligado até ser desligado: olha onde está num programa, lê a instrução guardada ali, descobre o que essa instrução significa, executa-a e decide onde olhar em seguida. Esse laço se chama **ciclo de busca, decodificação e execução**, e é uma das ideias organizadoras mais importantes de toda a arquitetura de computadores; talvez mais importante que qualquer instrução isolada, porque é o ciclo que transforma uma lista estática de padrões de bits codificados guardados na memória numa máquina que de fato roda e calcula. O curso 6.004 do MIT, em "Building the Beta", apresenta exatamente essa visão: um processador não é um saco de circuitos especializados para cada instrução, mas um único laço uniforme (buscar, decodificar, executar, repetir) cujo comportamento em cada passagem é inteiramente determinado pelos bits da instrução para a qual o contador de programa estiver apontando.

Este conceito se constrói diretamente sobre the-control-unit e the-datapath-registers-alu-and-buses. O datapath fornece o hardware físico (banco de registradores, ULA, memórias, barramentos e multiplexadores) pelo qual os dados podem fluir. A unidade de controle fornece a lógica de decodificação que olha os campos opcode e funct de uma instrução e decide qual configuração cada multiplexador e linha de controle desse datapath deve assumir. O que faltava era a descrição unificadora de como essas duas peças cooperam, batida após batida, para rodar um programa do início ao fim: essa descrição é o ciclo de busca, decodificação e execução. Depois de entendido, a disciplina converge para um único retorno, entregue no conceito final: ligar cada peça construída a partir das portas NAND numa CPU monociclo completa e funcional.

## Teoria Central

### Os quatro passos, em abstrato

O ciclo de busca, decodificação e execução costuma ser descrito em quatro passos, e vale ser preciso sobre o que cada passo realiza, independentemente de qualquer implementação de hardware específica:

1. **BUSCA.** Ler a palavra de instrução guardada no endereço que está no contador de programa (PC). Isso significa apresentar o PC como endereço à memória de instruções e ler de volta a palavra de instrução de 32 bits encontrada ali.
2. **DECODIFICAÇÃO.** Interpretar os bits da instrução buscada. A unidade de controle examina o opcode (e, quando relevante, o campo funct) para determinar qual instrução é esta e, por consequência, quais sinais de controle devem ser ativados. Ao mesmo tempo, o banco de registradores é lido: os campos rs1 e, nas instruções tipo R e de store, rs2 da instrução selecionam quais valores de registradores aparecem nos barramentos de dado lido do datapath.
3. **EXECUÇÃO.** A ULA calcula um resultado a partir dos seus dois operandos (um sempre um valor de registrador, o outro um segundo valor de registrador ou um imediato com extensão de sinal, selecionado pelo sinal de controle ALUSrc). Em lw e sw, esse resultado da ULA é um endereço de memória, então um load ou store acessa também a memória de dados nesse endereço. Toda instrução que produz um valor destinado a um registrador (add, addi, lw e semelhantes) escreve esse valor de volta no banco de registradores, escolhendo entre o resultado da ULA e o dado lido da memória pelo multiplexador WBSel (seleção de write-back).
4. **ATUALIZAÇÃO DO PC.** O contador de programa avança para apontar para a próxima instrução. No caso comum, isso é simplesmente PC+4 (a próxima palavra na memória, já que cada instrução tem 4 bytes). Se a instrução for um desvio cuja condição é satisfeita (beq com operandos iguais, detectado pela flag Zero da ULA), o PC passa a ser o endereço do alvo de desvio, PC + deslocamento, redirecionando o fluxo de controle para fora da execução estritamente sequencial.

### Por que os quatro passos acontecem num período de clock numa máquina monociclo

É tentador imaginar busca, decodificação, execução e atualização do PC como quatro passos separados acontecendo um depois do outro no tempo, cada um levando sua própria batida de clock; e em alguns projetos de processador (multiciclo ou com pipeline, vistos na disciplina seguinte de Arquitetura de Computadores) isso é mais próximo da verdade. Mas a CPU construída nesta disciplina é um projeto **monociclo**, e num projeto monociclo os quatro passos acontecem dentro de um único período de clock, como um fluxo contínuo e ininterrupto de lógica combinacional se estabilizando nos seus valores finais.

Concretamente: o datapath e a unidade de controle construídos nos dois conceitos anteriores são ambos, exceto pelo banco de registradores e pelo registrador PC, lógica puramente combinacional (redes de portas e multiplexadores sem memória interna própria). Quando acontece a borda de clock que encerra um ciclo, ela captura valores novos em exatamente dois tipos de armazenamento: o registrador PC (seu próximo valor, calculado durante o ciclo que acabou) e o banco de registradores (se RegWrite estiver ativado, um novo valor no registrador de destino). Nesse instante, o PC recém-capturado vira uma entrada estável da memória de instruções, que emite a nova palavra de instrução. Essa palavra se propaga pela unidade de controle (decodificação), pelas portas de leitura do banco de registradores e pela ULA (execução), e pela memória de dados se necessário, e por fim volta ao mux ALUSrc, ao mux WBSel e à lógica do somador do PC e do alvo de desvio: uma cascata ininterrupta de atrasos de porta, sem nenhuma batida de clock entre esses estágios. Só quando todo sinal se estabiliza chega a próxima borda de clock, capturando os resultados e recomeçando a cascata. É por isso que os quatro "passos" do ciclo de busca, decodificação e execução são uma decomposição conceitual do que acontece, e não quatro ciclos de clock literais: são quatro regiões de um único circuito combinacional, todas se estabilizando no intervalo limitado por duas bordas de clock consecutivas.

### O PC como o fio do controle

O contador de programa merece ênfase especial porque é o único pedaço de estado que, acima de todo o resto, captura "onde a máquina está" num programa em execução num dado momento. Tudo o mais na máquina (valores de registradores, conteúdo de memória) são dados com os quais o programa opera. Só o PC identifica qual instrução vem em seguida e, portanto, quais sinais de controle serão ativados, quais registradores serão lidos e escritos e quais locais de memória serão tocados no ciclo seguinte. Um programa sequencial, sem desvios, simplesmente avança o PC 4 a cada ciclo, descendo direto pelos endereços consecutivos da memória de instruções. Uma instrução de desvio é o mecanismo pelo qual um programa consegue escapar da execução estritamente linear: quando sua condição vale, o PC é redirecionado para algum outro endereço, e o ciclo continua a partir dali exatamente como se esse endereço sempre tivesse sido o próximo. Esse é o mecanismo inteiro, em nível de hardware, por trás de laços, condicionais e chamadas de função em toda linguagem de programação compilada, no fim, para esta ISA: todos se reduzem, lá embaixo, a instruções que deixam o PC avançar normalmente ou o redirecionam.

### O ciclo se repete, inalterado, bilhões de vezes por segundo

O notável no ciclo de busca, decodificação e execução é sua uniformidade total: o datapath e a unidade de controle não sabem nem se importam se estão rodando a primeira instrução de um programa ou a de número dez bilhões. A cada período de clock, incondicionalmente, a mesma cascata de quatro passos acontece: a instrução que o PC nomear no momento é buscada, decodificada e executada, e o PC é atualizado. Um processador rodando a 3 gigahertz executa esse ciclo idêntico cerca de três bilhões de vezes por segundo, e a complexidade aparente de um sistema operacional, um navegador ou um jogo em execução não passa de uma sequência extraordinariamente longa e rápida de passagens por esse único laço imutável, com o comportamento específico de cada passagem determinado inteiramente pelos bits da instrução que estiverem no PC atual.

## Exemplos Resolvidos

### Exemplo 1: um ciclo completo de `add x7, x5, x6`

Usando o programa de exemplo compartilhado, suponha que o PC guarde `0x08`, e que os registradores já guardem `x5 = 5` e `x6 = 10` das duas instruções `addi` anteriores.

**Busca.** O PC (`0x08`) é apresentado à memória de instruções, que devolve a palavra de instrução que codifica `add x7, x5, x6`: uma instrução tipo R que nomeia rs1 = x5, rs2 = x6, rd = x7.

**Decodificação.** A unidade de controle lê os campos opcode/funct, reconhece um add tipo R e ativa: RegWrite = 1, ALUSrc = 0 (o segundo operando da ULA é um registrador, não um imediato), ALUControl = add, MemRead = 0, MemWrite = 0, WBSel = resultado da ULA, Branch = 0. Ao mesmo tempo, as duas portas de leitura do banco de registradores são comandadas por rs1 = x5 e rs2 = x6, produzindo os valores lidos 5 e 10.

**Execução.** O mux ALUSrc seleciona o valor vindo do registrador, 10, como segundo operando da ULA, junto com 5 como primeiro operando. A ULA, configurada pelo ALUControl para somar, calcula 5 + 10 = 15. Não há acesso à memória de dados, já que MemRead = MemWrite = 0. O mux WBSel seleciona o resultado da ULA (15) como o valor a escrever de volta.

**Atualização do PC.** Branch = 0, então o PCSrc seleciona PC+4, seja qual for a flag Zero da ULA. O PC vira `0x08 + 4 = 0x0C`.

**Borda de clock.** RegWrite = 1, então na próxima borda de clock x7 recebe o valor 15; o PC recebe o valor `0x0C`. Estado depois deste ciclo: x5 = 5, x6 = 10, x7 = 15, PC = `0x0C`.

### Exemplo 2: um ciclo completo de `lw x8, 0(x0)`

O PC agora guarda `0x10`. Pela instrução anterior (`sw x7, 0(x0)`), mem[0] = 15.

**Busca.** A memória de instruções devolve a palavra `lw x8, 0(x0)`: opcode = load, rs1 = x0, rd = x8, deslocamento imediato = 0.

**Decodificação.** A unidade de controle reconhece um load e ativa: RegWrite = 1, ALUSrc = 1 (o segundo operando da ULA é o imediato com extensão de sinal), ALUControl = add (o cálculo de endereço é sempre uma soma), MemRead = 1, MemWrite = 0, WBSel = dado da memória, Branch = 0. A porta de leitura do banco de registradores para rs1 = x0 devolve 0 (x0 é fixo em zero).

**Execução.** A ULA calcula o endereço efetivo: 0 (de x0) + 0 (imediato) = 0. Como MemRead = 1, a memória de dados é lida no endereço 0, devolvendo o valor guardado: 15. O mux WBSel, configurado em "dado da memória", seleciona esse valor (15), e não o resultado da ULA, como o valor destinado ao banco de registradores.

**Atualização do PC.** Branch = 0, então o PC vira `0x10 + 4 = 0x14`.

**Borda de clock.** x8 recebe 15; o PC recebe `0x14`. Estado depois deste ciclo: x7 = 15, x8 = 15, mem[0] = 15, PC = `0x14`.

### Exemplo 3: um ciclo completo do desvio tomado `beq x7, x8, +8`

O PC agora guarda `0x14`. Pelas duas instruções anteriores, x7 = 15 e x8 = 15.

**Busca.** A memória de instruções devolve a palavra `beq x7, x8, +8`: opcode = desvio, rs1 = x7, rs2 = x8, deslocamento imediato = 8.

**Decodificação.** A unidade de controle reconhece um desvio e ativa: RegWrite = 0 (desvios nunca escrevem num registrador), ALUSrc = 0 (a ULA compara dois valores de registrador diretamente), ALUControl = subtract (a igualdade é testada por subtração: a ULA calcula rs1 menos rs2, e o Zero é ativado exatamente quando o resultado é zero), MemRead = 0, MemWrite = 0, Branch = 1. As duas portas de leitura do banco de registradores devolvem 15 e 15.

**Execução.** A ULA calcula 15 − 15 = 0 e, como o resultado é exatamente zero, a flag Zero da ULA é ativada (Zero = 1). Não há acesso à memória de dados.

**Atualização do PC.** O PCSrc é calculado como (Branch AND Zero); aqui Branch = 1 e Zero = 1, então o PCSrc seleciona o caminho do alvo de desvio: PC + deslocamento = `0x14 + 8 = 0x1C`, em vez de PC + 4.

**Borda de clock.** RegWrite = 0, então nenhum registrador é escrito. O PC recebe `0x1C`. Estado depois deste ciclo: x7 = 15, x8 = 15, mem[0] = 15, PC = `0x1C`: o controle saltou por cima da instrução que estiver (se houver alguma) em `0x18`.

A tabela abaixo resume os três ciclos lado a lado:

| Ciclo | PC antes | Instrução | Principais sinais de controle | Resultado da ULA / Zero | PC depois |
|---|---|---|---|---|---|
| 3 | 0x08 | add x7, x5, x6 | RegWrite=1, ALUSrc=0, ALUControl=add | 15 | 0x0C |
| 5 | 0x10 | lw x8, 0(x0) | RegWrite=1, ALUSrc=1, MemRead=1, WBSel=mem | end=0, mem[0]=15 | 0x14 |
| 6 | 0x14 | beq x7, x8, +8 | Branch=1, ALUControl=subtract | 0, Zero=1 | 0x1C (tomado) |

## Equívocos Comuns e Armadilhas

- **"Busca, decodificação, execução e atualização do PC são quatro ciclos de clock separados."** Nesta CPU monociclo, não são quatro batidas do clock; são quatro estágios conceituais de um único caminho de sinal combinacional contínuo que se estabiliza por completo dentro de um único período de clock, com exatamente uma borda de clock por instrução capturando os resultados. Os projetos multiciclo e com pipeline, vistos mais adiante em Arquitetura de Computadores, de fato dividem esses estágios em vários ciclos de clock, mas esse é um projeto diferente e mais elaborado, não a máquina construída aqui.
- **"A unidade de controle decide o que fazer depois que a ULA já calculou algo."** Decodificação e execução não acontecem nessa ordem temporal como batidas de clock separadas; os sinais da unidade de controle (ALUSrc, ALUControl e assim por diante) são funções combinacionais só do opcode, e precisam estar estáveis antes ou exatamente quando as entradas da ULA chegam, já que as próprias entradas da ULA dependem desses sinais de controle. Tudo se estabiliza junto dentro de um período de clock.
- **"O PC só avança de 4 em 4."** PC+4 é o padrão, usado por toda instrução que não desvia e pelos desvios cuja condição falha, mas um desvio tomado substitui esse padrão por completo, redirecionando o PC para um endereço alvo calculado arbitrário: precisamente o mecanismo que implementa laços e condicionais em nível de hardware.
- **"Toda instrução toca o mesmo hardware do mesmo jeito."** Instruções diferentes ativam subconjuntos totalmente diferentes de sinais de controle (um add nunca ativa MemRead nem MemWrite, um lw ativa MemRead mas não MemWrite, um beq não ativa nenhum dos dois e nunca ativa RegWrite), embora o passo de busca e o formato geral da cascata do datapath sejam idênticos para todas as instruções.
- **"O ciclo de busca, decodificação e execução é uma simplificação que CPUs reais abandonam."** Ele não é abandonado; é elaborado. Mesmo processadores superescalares com pipelines profundos e execução fora de ordem ainda, no fundo, buscam instruções de onde o ponteiro de instrução (possivelmente especulativo) indica, decodificam, executam e aposentam os resultados na ordem do programa; o ciclo descrito aqui é o esqueleto conceitual que todo projeto de CPU mais sofisticado ainda respeita.

## Resumo

O ciclo de busca, decodificação e execução é o único laço repetitivo (buscar a instrução no endereço nomeado pelo contador de programa, decodificar seu opcode para determinar os sinais de controle e ler os registradores necessários, executá-la pela ULA (e pela memória de dados, em loads e stores) e atualizar o contador de programa para o endereço da próxima instrução) que toda CPU faz, de forma incondicional e inalterada, a cada período de clock, de ser ligada até ser desligada. Na máquina monociclo construída aqui, os quatro estágios não são batidas sequenciais de clock, mas quatro regiões de uma única cascata combinacional ininterrupta que se estabiliza por completo dentro de um único período de clock, com uma borda de clock por instrução capturando o novo valor do PC e, quando aplicável, um novo valor no banco de registradores. O contador de programa é o único pedaço de estado que identifica a posição atual da máquina no programa em execução, tendo PC+4 como padrão no fluxo sequencial, mas saltando para um alvo de desvio calculado sempre que a condição da flag Zero de um desvio condicional tomado for satisfeita: o mecanismo de hardware exato por trás de todo laço e condicional em todo programa de nível mais alto compilado, no fim, para este conjunto de instruções. Estabelecido com precisão como uma instrução é executada do início ao fim, o conceito final desta disciplina monta cada peça construída até aqui (portas, ULA, registradores, memória, datapath e unidade de controle) numa CPU monociclo completa e funcional, e roda um programa real nela, ciclo a ciclo.

## Documentation Links

- [MIT 6.004: Building the Beta](https://computationstructures.org/lectures/beta/beta.html): apresenta o laço de busca, decodificação e execução como o princípio organizador uniforme da implementação monociclo do processador Beta.
- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): desenvolve o datapath monociclo e os sinais de controle cuja estabilização combinacional implementa busca, decodificação, execução e atualização do PC dentro de um período de clock.
