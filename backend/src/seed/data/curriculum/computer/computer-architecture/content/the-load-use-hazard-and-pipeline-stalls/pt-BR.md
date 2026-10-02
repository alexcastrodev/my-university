---
version: 1.0
updatedAt: 2026-09-06
title: O Hazard de Load-Use e as Paradas do Pipeline
summary: Um hazard de dados que o forwarding não consegue apagar por completo. O valor de um load só fica disponível depois do estágio de Memória, então uma instrução que depende dele logo em seguida ainda precisa de um ciclo de bolha, uma parada que um compilador esperto muitas vezes consegue esconder por inteiro reordenando instruções independentes para essa lacuna.
---
## Objetivos de Aprendizagem

- Explicar com precisão por que o forwarding sozinho não consegue resolver um load seguido imediatamente de uma instrução que usa seu resultado.
- Rastrear, ciclo a ciclo, como uma unidade de detecção de hazards insere uma bolha de um ciclo para resolver o hazard de load-use.
- Calcular o custo em CPI de uma parada por load-use para um programa com uma frequência conhecida desse padrão.
- Explicar como o escalonamento de instruções pelo compilador pode reduzir, embora não eliminar, a frequência das paradas por load-use.
- Distinguir uma "parada" (stall, uma bolha injetada no pipeline) de um "flush" (descartar uma instrução já buscada), antecipado para o conceito de hazards de controle que vem a seguir.

## Contexto e Motivação

O conceito anterior mostrou que os hazards de dados comuns (uma instrução usando um valor que uma anterior acabou de calcular) são resolvidos de graça, com zero ciclos de parada, encaminhando um valor diretamente da saída de um estágio posterior do pipeline para a entrada de um estágio anterior. Esse mecanismo depende de uma suposição silenciosa: que o valor da instrução produtora já existe, guardado em algum registrador de pipeline, exatamente no ciclo em que a instrução consumidora precisa dele. Para uma instrução de load, essa suposição falha, por um motivo enraizado puramente no tempo fixo do pipeline, e não em alguma falha do próprio hardware de forwarding.

Isso importa o bastante para merecer um conceito próprio, em vez de virar nota de rodapé do anterior, porque `lw` seguido imediatamente de uma instrução que usa o valor carregado é código real excepcionalmente comum: `int x = arr[i]; return x + 1;` é compilado exatamente para esse padrão. Entender exatamente por que este único caso resiste à correção por forwarding, e exatamente o que o hardware faz no lugar, completa o relato honesto da disciplina sobre o custo do pipelining, continuando o tema com que a Lei de Ferro abriu todo este bloco: todo ganho de desempenho precisa ser pago em algum lugar, e este é um dos lugares onde a conta do pipelining chega.

## Teoria Central

### Por que o forwarding fica sem tempo num load

Volte ao tempo com que o conceito anterior terminou:

```text
Ciclo:            1    2    3    4    5    6
lw x1,0(x2):      IF   ID   EX   MEM  WB
add x3,x1,x4:          IF   ID   EX   MEM  WB
```

O valor carregado por `lw` só é calculado quando seu próprio estágio MEM termina, no ciclo 4. Mas `add`, a instrução seguinte, precisa desse valor como entrada do *seu próprio* estágio EX, que também roda no ciclo 4, exatamente o mesmo ciclo. O forwarding encaminha um valor de onde quer que ele esteja, correto, naquele momento para onde ele é necessário em seguida; aqui, o valor simplesmente ainda não existe em lugar nenhum no momento em que precisaria ser encaminhado. Nenhuma quantidade de fiação extra muda isso: o valor fundamentalmente não fica pronto um ciclo antes do que o próprio estágio MEM do load o produz, e o estágio EX de `add` está agendado exatamente um ciclo depois do estágio EX de `lw`, um estágio cedo demais.

### A correção: detectar e inserir um ciclo de parada

Uma unidade de detecção de hazards, observando a instrução que está em ID (prestes a entrar em EX no próximo ciclo) e a instrução à frente dela em EX, verifica especificamente este padrão: a instrução em EX é um load, e a instrução em ID usa o registrador de destino desse load como operando de origem? Se sim, o hardware **para** o pipeline por exatamente um ciclo: segura a instrução dependente (e o próprio load, que agora chegou legitimamente a MEM) no lugar por um ciclo extra e insere uma **bolha** (um ciclo em que o estágio que, de outro modo, teria começado uma instrução nova não faz nada, equivalente a inserir um no-op) no estágio EX que, de outro modo, teria tentado usar prematuramente o valor ainda não pronto.

```mermaid
flowchart LR
    A["Detecta: a instr em EX é um load,\na instr em ID usa seu registrador de destino"] --> B["Segura IF e ID\npor 1 ciclo extra"]
    B --> C["Insere 1 bolha\nem EX"]
    C --> D["Agora encaminha normalmente\n(valor pronto 1 ciclo depois)"]
```

Depois de exatamente um ciclo de bolha, o valor do load (agora guardado no registrador de pipeline EX/MEM, tendo concluído MEM um ciclo antes de a instrução dependente, atrasada, chegar a EX) pode ser encaminhado normalmente, usando exatamente o mesmo hardware de forwarding do conceito anterior. O hazard de load-use custa exatamente **um** ciclo de parada, não mais, justamente porque atrasar a instrução dependente em um ciclo basta para deixar o caminho comum de forwarding de EX/MEM para EX do conceito anterior assumir.

### O custo de um ciclo, rastreado explicitamente

```text
Ciclo:            1    2    3    4    5    6    7
lw x1,0(x2):      IF   ID   EX   MEM  WB
add x3,x1,x4:          IF   ID   ID*  EX   MEM  WB
                                  (bolha em EX
                                   neste ciclo)
```

A instrução `add` fica em ID por dois ciclos em vez de um (repetindo o estágio ID, ou, equivalentemente, mantendo a saída do seu registrador ID/EX como bolha por um ciclo; livros-texto diferentes desenham esse detalhe de formas um pouco diferentes, mas o custo líquido é idêntico): o pipeline perde, na prática, um ciclo de avanço, e toda instrução buscada depois de `add` é igualmente atrasada nesse mesmo ciclo.

### Mitigação: escalonamento pelo compilador

Como o hazard só dispara quando a instrução *imediatamente* seguinte a um load usa o resultado desse load, um compilador que reordene instruções independentes e sem relação para ficarem entre um load e seu primeiro uso consegue esconder por completo a penalidade de um ciclo: o valor do load fica pronto exatamente durante o ciclo em que uma instrução sem relação está legitimamente rodando em EX, e, quando a instrução de fato dependente chega a EX, o valor já está disponível pelo forwarding comum, sem parada nenhuma. É uma otimização de compilador genuína e real (às vezes chamada de preenchimento de load delay slot em algumas ISAs históricas, ou simplesmente escalonamento de instruções nas modernas), mas é uma mitigação, e não uma eliminação: um compilador nem sempre encontra trabalho independente para inserir (uma cadeia de dependências apertada como `x1 = arr[i]; x2 = x1 + 1;` não tem nenhuma instrução sem relação disponível), então o hardware de detecção de hazards descrito aqui precisa existir, por melhor que o compilador seja.

## Exemplos Resolvidos

### Exemplo 1: calculando o custo em CPI a partir de uma frequência de paradas

Suponha que o profiling de um programa real mostre que 20% de todas as instruções executadas são loads e que, desses loads, 30% são seguidos imediatamente de uma instrução que usa o valor carregado (disparando uma parada de um ciclo). Supondo um CPI base de 1, sem nenhum hazard, calcule o CPI efetivo incluindo as paradas por load-use:

```text
Fração das instruções que causam parada de 1 ciclo = 0.20 × 0.30 = 0.06 (6%)
Ciclos extras por instrução, em média               = 0.06 × 1 ciclo de parada = 0.06
CPI efetivo                                         = 1 + 0.06 = 1.06
```

Uma frequência de paradas aparentemente pequena, de 6%, aumenta o CPI em 6%, piorando diretamente um fator da Lei de Ferro de `cpu-performance-and-the-iron-law-of-performance`, um efeito completamente realista e mensurável em processadores reais com pipeline.

### Exemplo 2: uma cadeia de dependências que o compilador não consegue esconder

```text
lw  x1, 0(x2)         # x1 := memória[x2]
add x1, x1, x1         # x1 := x1 + x1  (precisa de x1 no instante seguinte ao load)
```

Não há nenhuma instrução sem relação disponível para inserir entre essas duas linhas sem mudar o significado do programa: `add` depende direta e imediatamente do resultado de `lw`, sem mais nada para o compilador escalonar no meio. Esse caso concreto é exatamente o motivo pelo qual o hardware de detecção de hazards e de parada deste conceito é uma parte obrigatória da lógica de controle do pipeline, e não um recurso opcional que um compilador esperto o bastante poderia tornar desnecessário.

### Exemplo 3: escalonamento bem-sucedido pelo compilador

```text
Antes do escalonamento:              Depois do escalonamento (funcionalmente idêntico):
lw  x1, 0(x2)                        lw  x1, 0(x2)
add x3, x1, x4   (para 1 ciclo)      or  x9, x9, x9   (independente, preenche a lacuna)
                                      add x3, x1, x4   (sem parada: valor agora
                                                          pronto pelo forward comum)
```

Movendo uma instrução `or` sem relação (que ia executar em algum lugar do programa de qualquer jeito) para ficar logo depois do load, o compilador garante que, quando `add` chega a EX, o resultado de `lw` já avançou um ciclo a mais no pipeline e está disponível pelos mesmos caminhos de forwarding de EX/MEM para EX ou de MEM/WB para EX do conceito anterior, eliminando a parada sem nenhuma mudança no comportamento real do programa, só na ordem das instruções.

## Equívocos Comuns e Armadilhas

- **"O forwarding também deveria conseguir corrigir isso, com um circuito mais esperto."** Nenhuma quantidade de fiação adicional muda o tempo físico: o valor carregado simplesmente não existe como sinal em lugar nenhum do hardware até o próprio estágio MEM do load terminar, um ciclo depois do que o estágio EX da instrução dependente rodaria. Uma parada é a correção fundamental, e não uma limitação de hardware à espera de ser contornada pela engenharia.
- **"Uma parada por load-use custa mais de um ciclo."** Neste pipeline simples de 5 estágios, ela custa exatamente um ciclo, porque atrasar a instrução dependente em exatamente um ciclo basta para alinhá-la com os mesmos caminhos de forwarding já construídos para os hazards de dados comuns.
- **"O compilador sempre consegue eliminar as paradas por load-use reordenando."** O Exemplo 2 mostra um caso genuíno e comum (uma dependência apertada e imediata) em que nenhuma reordenação é possível sem mudar o significado do programa. O escalonamento pelo compilador reduz a *frequência* das paradas em programas reais, mas o hardware de detecção de hazards ainda precisa existir para tratar os casos que ele não consegue esconder.
- **"Uma parada e um flush são a mesma coisa."** Uma parada (este conceito) segura instruções no lugar por um ou mais ciclos e não perde nenhuma instrução correta já buscada; só as atrasa. Um flush (apresentado no próximo conceito, para hazards de controle) descarta instruções que foram buscadas com base numa suposição errada e precisam ser refeitas do zero, um tipo estritamente mais caro de perturbação do pipeline.

## Resumo

Um hazard de load-use (um load seguido imediatamente de uma instrução que usa seu resultado) não pode ser resolvido só pelo forwarding, porque o valor carregado genuinamente não existe em lugar nenhum do hardware até o próprio estágio MEM do load terminar, exatamente um ciclo depois do que o estágio EX da instrução dependente precisaria. A unidade de detecção de hazards resolve isso parando o pipeline por exatamente um ciclo, inserindo uma bolha, depois da qual os caminhos comuns de forwarding do conceito anterior assumem normalmente; um bom compilador muitas vezes consegue esconder esse custo de um ciclo escalonando instruções independentes para a lacuna, embora nem sempre, já que algumas cadeias de dependências não deixam trabalho independente disponível. Tendo coberto os dois tipos de hazard que os dados podem causar (o RAW comum, resolvido de graça pelo forwarding; o load-use, resolvido com exatamente uma parada), o próximo conceito se volta para uma fonte fundamentalmente diferente de perturbação do pipeline: os hazards de controle, em que o problema não é um valor atrasado, e sim o pipeline ainda não saber quais instruções deveria sequer estar buscando.

## Documentation Links

- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): cobre o hazard de load-use, o projeto da unidade de detecção de hazards e exatamente a parada de um ciclo que este conceito desenvolve.
- [Bryant & O'Hallaron: Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/): a lógica de tratamento de hazards do processador PIPE inclui a mesma condição de parada por load/use no seu pipeline Y86-64.
