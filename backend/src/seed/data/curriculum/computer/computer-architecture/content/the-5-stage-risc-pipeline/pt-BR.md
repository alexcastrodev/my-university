---
version: 1.0
updatedAt: 2026-09-06
title: "O Pipeline RISC de 5 Estágios: IF-ID-EX-MEM-WB"
summary: Dividir o datapath de ciclo único em cinco pontos naturais (Busca, Decodificação, Execução, Memória, Escrita de Volta), com um registrador de pipeline guardando o estado entre cada estágio, para que cinco instruções diferentes possam ocupar os cinco estágios ao mesmo tempo, com um ciclo de diferença entre si.
---
## Objetivos de Aprendizagem

- Nomear os cinco estágios do pipeline RISC clássico (IF, ID, EX, MEM, WB) e dizer que trabalho cada estágio faz.
- Explicar o papel de um registrador de pipeline colocado entre dois estágios adjacentes e o que ele precisa guardar.
- Desenhar e ler um diagrama de pipeline mostrando várias instruções ocupando estágios diferentes no mesmo ciclo.
- Explicar por que o datapath já construído em Lógica Digital e Organização de Computadores quase não precisa de unidades funcionais novas para ganhar um pipeline: só registradores de pipeline e, mais adiante, lógica de tratamento de hazards.
- Identificar, para um dado tipo de instrução, quais estágios ela de fato usa e por quais apenas passa sem usá-los.

## Contexto e Motivação

O conceito anterior estabeleceu, em abstrato, que sobrepor instruções entre estágios aumenta a vazão. Este conceito torna essa ideia concreta dando a ela uma forma exata de hardware: o pipeline RISC clássico de 5 estágios, a estrutura específica que esta disciplina (assim como o "Pipelining the Beta" do MIT 6.004 e o capítulo de pipeline de Harris & Harris) constrói a partir do mesmo datapath de ciclo único já montado no fim de Lógica Digital e Organização de Computadores.

O fato tranquilizador que vale dizer com todas as letras é que o pipelining *não* exige reprojetar a ULA, o banco de registradores nem a memória: as unidades funcionais construídas para a CPU de ciclo único são reaproveitadas praticamente sem mudança. O que o pipelining acrescenta é um conjunto de **registradores de pipeline**, um colocado entre cada par de estágios adjacentes, cujo único trabalho é guardar todo sinal de que um estágio posterior vai precisar, para que esse estágio possa continuar trabalhando nele num ciclo posterior, depois que o estágio anterior já passou para outra instrução. O trabalho deste conceito é nomear os cinco estágios com precisão e mostrar onde esses registradores de pipeline ficam; os conceitos seguintes gastam seu esforço em tudo o que dá errado quando instruções em estágios diferentes precisam interagir, que é onde mora a complexidade real do pipelining.

## Teoria Central

### Os cinco estágios

O pipeline RISC clássico divide a execução das instruções exatamente nos cinco passos já implícitos no ciclo de busca-decodificação-execução do datapath de ciclo único:

1. **IF (Instruction Fetch, busca da instrução).** Ler a palavra de instrução da memória de instruções no endereço do contador de programa (PC) e calcular PC+4 (ou o equivalente da ISA) como próximo PC padrão.
2. **ID (Instruction Decode / Register Read, decodificação e leitura de registradores).** Decodificar o opcode e ler os dois operandos de registrador de origem do banco de registradores; também estender o sinal de qualquer campo imediato que a instrução carregue.
3. **EX (Execute, execução).** A ULA calcula o resultado real da instrução: uma operação aritmética/lógica, ou um endereço de memória para um load/store, ou o destino/condição de um desvio.
4. **MEM (Memory Access, acesso à memória).** Num load, ler a memória de dados no endereço calculado em EX; num store, escrever nela. Instruções que não tocam a memória (como uma soma de registrador para registrador) simplesmente passam por este estágio sem fazer nada.
5. **WB (Write-Back, escrita de volta).** Escrever o resultado final da instrução de volta no banco de registradores: o resultado da ULA numa instrução aritmética, ou o valor carregado num load.

### Registradores de pipeline

Entre cada par de estágios adjacentes fica um registrador de pipeline (IF/ID, ID/EX, EX/MEM e MEM/WB), que é escrito a cada borda de clock com tudo de que o próximo estágio (e, por consequência, os estágios posteriores) vai precisar. Por exemplo, o registrador ID/EX precisa levar adiante não só os dois valores de registrador recém-lidos, mas também o número do registrador de destino e os sinais de controle (é um load? um desvio? qual operação da ULA?) calculados lá em ID, já que os estágios EX, MEM e WB ainda precisam saber que tipo de instrução é essa muito depois que o próprio estágio ID passou a decodificar a próxima instrução.

```mermaid
flowchart LR
    IF["IF\nBusca da\nInstrução"] --> R1["reg\nIF/ID"]
    R1 --> ID["ID\nDecodificação /\nLeitura de Reg"]
    ID --> R2["reg\nID/EX"]
    R2 --> EX["EX\nULA"]
    EX --> R3["reg\nEX/MEM"]
    R3 --> MEM["MEM\nAcesso\na Dados"]
    MEM --> R4["reg\nMEM/WB"]
    R4 --> WB["WB\nEscrita no\nRegistrador"]
```

### Reaproveitando as unidades funcionais do datapath de ciclo único

Toda unidade funcional de Assembling a Complete Single-Cycle CPU reaparece aqui sem mudança: o mesmo banco de registradores (agora lido uma vez por instrução em ID e escrito uma vez por instrução em WB, em vez de as duas coisas acontecerem no mesmo ciclo único), a mesma ULA (agora fazendo seu trabalho no seu próprio ciclo EX dedicado, em vez de dividir um ciclo com todo o resto) e a mesma memória de dados (agora acessada no seu próprio ciclo MEM dedicado). O que é genuinamente novo não é nenhuma unidade funcional, e sim os registradores de pipeline que guardam o estado em andamento de cada instrução conforme ela avança para a direita no diagrama, um estágio por ciclo.

### Nem toda instrução usa cada estágio do mesmo jeito

Uma instrução que não toca a memória (uma soma de registrador para registrador, por exemplo) ainda passa fisicamente pelo estágio MEM, simplesmente sem fazer nada útil ali, porque num pipeline fixo de 5 estágios toda instrução leva os mesmos cinco ciclos para atravessar o pipeline inteiro, precise ou não da função real de cada estágio. Essa uniformidade (toda instrução leva exatamente 5 ciclos da Busca à Escrita de Volta, qualquer que seja o tipo) é precisamente o que mantém simples a lógica de controle do pipeline; a alternativa (instruções de comprimentos diferentes pulando estágios de que não precisam) reintroduziria complexidade estrutural por um benefício de que este projeto simples de pipeline abre mão de propósito.

## Exemplos Resolvidos

### Exemplo 1: rastreando uma instrução pelos cinco estágios

Considere a instrução `add x5, x6, x7` (calcular x6 + x7 e guardar o resultado em x5) entrando no pipeline no ciclo 1:

```text
Ciclo:        1    2    3    4    5
add x5,x6,x7: IF   ID   EX   MEM  WB
```

- Ciclo 1 (IF): busca os bits da instrução `add` na memória de instruções.
- Ciclo 2 (ID): decodifica-a como um `add`; lê x6 e x7 do banco de registradores.
- Ciclo 3 (EX): a ULA calcula x6 + x7.
- Ciclo 4 (MEM): passa sem uso; `add` nunca toca a memória de dados.
- Ciclo 5 (WB): o resultado da ULA do ciclo 3 é escrito em x5.

### Exemplo 2: um diagrama de pipeline completo para quatro instruções

```text
Ciclo:    1    2    3    4    5    6    7    8
Instr 1:  IF   ID   EX   MEM  WB
Instr 2:       IF   ID   EX   MEM  WB
Instr 3:            IF   ID   EX   MEM  WB
Instr 4:                 IF   ID   EX   MEM  WB
```

No ciclo 4, todos os cinco estágios do pipeline estão ocupados ao mesmo tempo (a Instr 4 em IF, a Instr 3 em ID, a Instr 2 em EX, a Instr 1 em MEM), e a partir daí uma instrução completa seu WB a cada ciclo. Esse regime de "pipeline cheio" é exatamente o que faz a vazão se aproximar de uma instrução por ciclo num programa longo, coincidindo com a discussão de ganho ideal do conceito anterior.

### Exemplo 3: o que o registrador de pipeline ID/EX de fato precisa carregar

Para a instrução `lw x9, 8(x10)` (carregar a palavra no endereço x10+8 em x9), liste o que o registrador de pipeline ID/EX precisa guardar depois do estágio ID e por que cada parte ainda é necessária depois:

```text
Campo carregado no registrador ID/EX     Por que um estágio posterior ainda precisa dele
---------------------------------------  ----------------------------------------------
Valor do registrador x10                 EX precisa dele para calcular o endereço
Imediato com sinal estendido (8)         EX precisa dele para calcular o endereço
Número do registrador de destino (x9)    WB precisa saber onde escrever
Sinal de controle: "isto é um load"      MEM precisa saber que deve ler a memória
                                          (e não só passar);
                                          WB precisa saber que deve escrever o
                                          valor carregado, e não um resultado da ULA
```

Cada um desses campos já estava disponível lá em ID, mas o próprio ID já passou a decodificar a *próxima* instrução quando EX, MEM e WB de fato precisam deles, e é exatamente por isso que o registrador de pipeline existe: para levar adiante as informações de cada instrução, em sincronia com a própria instrução, conforme ela avança um estágio por ciclo.

## Equívocos Comuns e Armadilhas

- **"O pipelining exige um projeto completamente novo de ULA, memória e banco de registradores."** Ele reaproveita os três do datapath de ciclo único praticamente sem mudança; o hardware novo é quase inteiramente os registradores de pipeline entre os estágios, mais (a partir dos próximos conceitos) a lógica de detecção de hazards e de forwarding.
- **"Uma instrução que não precisa de um estágio o pula."** Neste projeto fixo de 5 estágios, toda instrução passa pelos cinco estágios numa ordem fixa, levando exatamente 5 ciclos de ponta a ponta, mesmo quando um estágio (como MEM, numa instrução que não acessa a memória) não tem nada de útil a fazer com ela.
- **"Os registradores de pipeline só atrasam dados; não precisam carregar informação de controle."** O Exemplo 3 mostra o oposto: os sinais de controle (é um load? um desvio? qual operação da ULA?) calculados em ID precisam viajar pelos mesmos registradores de pipeline que os dados, já que EX, MEM e WB dependem de saber que tipo de instrução estão processando no momento.
- **"Quando o pipeline enche, ele sempre completa exatamente uma instrução por ciclo, para sempre."** Esse é o caso ideal, sem hazards, que este conceito ilustra; os próximos conceitos (Hazards Estruturais, Hazards de Dados, Hazards de Controle) tratam todos das formas reais e específicas pelas quais esse ritmo constante de uma por ciclo pode quebrar, e de fato quebra.

## Resumo

O pipeline RISC clássico divide a execução de toda instrução em cinco estágios fixos (IF, ID, EX, MEM, WB), reaproveitando exatamente as unidades funcionais (banco de registradores, ULA, memória de dados) já construídas para a CPU de ciclo único, com registradores de pipeline inseridos entre cada estágio para levar adiante tanto os dados quanto as informações de controle, em sincronia, conforme a instrução avança um estágio por ciclo. Quando o pipeline enche, várias instruções ocupam estágios diferentes ao mesmo tempo e, no caso ideal, uma instrução nova completa sua escrita de volta a cada ciclo. Este conceito descreve esse comportamento ideal, de regime; os conceitos de hazards que vêm em seguida tratam todos das formas específicas e reais pelas quais duas instruções genuinamente em andamento ao mesmo tempo podem interferir uma na outra, e de quais técnicas de hardware ou de escalonamento resolvem cada tipo de interferência.

## Documentation Links

- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): constrói o datapath com pipeline diretamente a partir do mesmo projeto de ciclo único e da mesma ISA RISC-V que esta disciplina usa.
- [MIT 6.004: Pipelining the Beta](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/c15/): coloca o processador Beta num pipeline, estágio por estágio, com a mesma estrutura de 5 estágios.
