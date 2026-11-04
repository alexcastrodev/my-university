---
version: 1.0
updatedAt: 2026-11-04
title: "Consenso Baseado em Líder no Modelo Síncrono"
summary: "Consenso quando os atrasos de mensagem são limitados: escolha de líder por rodadas, o que um crash custa, o limite inferior de f+1 rodadas e por que este mundo simples é a referência contra a qual os protocolos assíncronos são medidos."
---
## Objetivos de Aprendizagem

- Enunciar o modelo síncrono de rodadas e a hipótese de crash, e dizer o que uma mensagem ausente prova nesse modelo.
- Rastrear um protocolo de consenso com coordenador rotativo e provar que um coordenador correto basta para o Acordo.
- Enunciar o limite inferior de f + 1 rodadas com a sua condição n >= f + 2, e acompanhar a cadeia de indistinguibilidade por trás dele.
- Explicar o que um crash custa e por que este mundo é a referência contra a qual os protocolos assíncronos são medidos.

## Contexto e Motivação

`the-consensus-problem-agreement-validity-and-termination` definiu o consenso, e `the-flp-impossibility-result` mostrou o que acontece quando todos os limites de tempo são removidos: nenhum protocolo determinístico consegue garantir a Terminação. Esta lição vai para o extremo oposto. Se os atrasos são limitados e o limite é conhecido, dá para escolher um líder sem eleição nenhuma. Restam duas perguntas: quantas rodadas o consenso ainda leva, e quanto dessa simplicidade depende de a hipótese de tempo ser verdadeira?

## Teoria Central

### O modelo síncrono de rodadas

Dwork, Lynch e Stockmeyer definem um sistema síncrono por dois limites conhecidos: um sobre o tempo de entrega de mensagens e outro sobre a velocidade relativa dos processadores. Esses limites permitem que um algoritmo rode em rodadas sincronizadas: em cada rodada, todo processo vivo envia, recebe o que foi enviado a ele e computa.

Até f dos n processos podem sofrer crash. Aspnes define a falha com precisão: em alguma rodada, parte ou todas as mensagens de um processo não são entregues, e nas rodadas seguintes nenhuma é. Um processo pode, portanto, morrer no meio de um broadcast, de modo que alguns pares o escutam e outros não.

A consequência importante é que o silêncio carrega informação. O Exemplo 1 de `the-flp-impossibility-result` mostrou que um processo assíncrono não consegue distinguir um crash de uma rede lenta. Aqui, uma mensagem que era devida na rodada r e não chegou prova que o remetente sofreu crash.

### Escolher um líder por escala

Por causa disso, o líder não precisa ser eleito. A escala o nomeia: a rodada r pertence ao processo p_r.

```text
est[i] := entrada de p_i
para r = 1 até f + 1:
    se i == r: faz broadcast de est[i]
    se um valor v chega de p_r na rodada r: est[i] := v
ao fim da rodada f + 1: decide est[i]
```

Chandra e Toueg chamam essa estrutura de paradigma do coordenador rotativo (rotating coordinator) e a usam em consenso assíncrono, onde ela precisa de um detector de falhas e de uma maioria. Eles apontam usos anteriores de Reischuk, Chang e Maxemchuk, Dwork et al. e Berman et al. A forma acima, só para crashes, é a instância mais simples dessa ideia, sem timestamps de estimativa nem confirmações, porque a sincronia os torna desnecessários.

O ponto de comparação é o flooding, que Aspnes atribui a Dolev e Strong: todo processo faz broadcast do conjunto de valores que conhece, em cada uma das f + 1 rodadas, e depois aplica uma regra fixa ao conjunto. Os dois levam f + 1 rodadas. A diferença é o número de remetentes por rodada: um coordenador em vez de todos os n. Para n = 5 e f = 2, são no máximo 12 mensagens contra 60, nas mesmas 3 rodadas.

### Por que um coordenador correto basta

Há f + 1 coordenadores distintos e no máximo f crashes, então algum coordenador p_c nunca sofre crash. (Isso exige n >= f + 1.)

```text
Rodada c: p_c alcança todo processo vivo, então todos eles
          passam a ter o mesmo valor v.
Depois de c: qualquer coordenador seguinte tem v e reenvia v.
          Nenhum outro valor existe entre os processos vivos.
```

O Acordo segue daí, e é uniforme: todo processo que chega ao fim da rodada f + 1 decide v, e um processo que caiu antes não decidiu nada. A Validade vale porque uma estimativa é sempre cópia de alguma entrada. A Terminação é o limite do laço.

### O que um crash custa

Um coordenador que cai no meio do broadcast divide as estimativas, e um coordenador posterior conserta a divisão. Um futuro coordenador que morre antes da sua vez também causa dano: a rodada dele passa sem broadcast, e uma rodada de reparo se perde. Nos dois casos, o crash consome uma das f + 1 vagas de coordenador, e é por isso que f crashes exigem f + 1 delas. O crash de um processo sem rodada de coordenação pela frente não custa nada.

O protocolo como escrito, porém, paga f + 1 rodadas mesmo sem crash nenhum: com rodadas de 50 ms e f = 2, leva 150 ms toda vez. Se p_1 é correto, o valor fica fixado depois da rodada 1, mas nenhum processo tem como saber que p_1 alcançou todos. Dolev, Reischuk e Strong separam dois casos. O acordo que precisa acontecer na mesma rodada exige t + 1 rodadas em alguma execução sem falhas, e este protocolo é desse tipo. Sem a exigência de simultaneidade, e com t < n - 1, o limite inferior é min(t + 1, f + 2) rodadas, onde t é o número de falhas toleradas e f o número real. O artigo deles estuda acordo bizantino; Wang, Teo e Cao depois provam o mesmo limite min(t + 1, f + 2) para crashes ordenados (orderly crash failures). Os dois resultados tratam de parada antecipada (early stopping), e Wang, Teo e Cao enunciam o deles para todos os processos corretos decidirem e pararem. Um processo pode decidir antes de parar, então o limite não diz que nenhum protocolo com crashes pode decidir antes da rodada f + 2.

### O limite inferior de f + 1

As f + 1 rodadas não são uma fraqueza do desenho com coordenador. Com n >= f + 2, todo algoritmo que satisfaz Acordo, Terminação e uma condição de não trivialidade precisa de pelo menos f + 1 rodadas em alguma execução. Aspnes credita o resultado original, enunciado para falhas bizantinas, a Dolev e Strong, a partir de uma prova mais complicada de Fischer e Lynch.

O estilo de prova é uma cadeia de indistinguibilidade. Se duas execuções parecem idênticas para algum processo não falho, esse processo decide igual nas duas, e o Acordo então força todos os processos não falhos das duas execuções a essa mesma decisão. Suponha um protocolo que para depois de f rodadas. Comece de uma execução sem falhas com todas as entradas 0 e mude as entradas um processo por vez, usando crashes para esconder cada mudança de testemunhas suficientes. Cada elo preserva a decisão, então entradas todas 0 e todas 1 teriam de decidir igual, o que contradiz a Validade.

Uma segunda prova corre para a frente. A apresentação de Abraham segue Aguilera e Toueg e mantém uma configuração não comprometida (as configurações bivalentes de `the-flp-impossibility-result`) por uma rodada para cada crash.

A condição n >= f + 2 importa. Aspnes observa que, com n = f + 1, o flooding resolve o acordo em f rodadas: ou no máximo f - 1 processos caem e o flooding funciona, ou exatamente f caem e o único sobrevivente concorda consigo mesmo.

### Por que esta é a referência

A Tabela I de Dwork, Lynch e Stockmeyer dá o menor sistema que tolera t processadores fail-stop sob cada hipótese de tempo:

```text
síncrono                               t
comunicação parcialmente síncrona      2t + 1
assíncrono                             nenhum número finito
```

A entrada da tabela é t; o protocolo com coordenador acima usa t + 1 processos para que um coordenador sobreviva. Tolerando dois crashes, portanto, ele roda em 3 processos, enquanto um protocolo para sincronia parcial precisa de 5. Essa diferença é o preço do silêncio ambíguo: quando um timeout não prova nada, uma decisão precisa se apoiar numa maioria, para que os dois lados de uma suspeita falsa não possam agir ao mesmo tempo. Em troca, a segurança deixa de depender do tempo. Em [Paxos Made Simple](/papers/paxos-made-simple), Lamport escreve que "safety is ensured regardless of the success or failure of the election", e que uma eleição confiável "must use either randomness or real time". O protocolo síncrono ganha um líder de graça e uma linha de chegada fixa, e paga estando errado se o limite de tempo for violado.

## Exemplos Resolvidos

### Exemplo 1: uma divisão que o coordenador seguinte conserta

Considere n = 4 e f = 2, com entradas a, b, c, d. As duas falhas são coordenadores caindo no meio do broadcast, uma das formas de derrotar uma execução de duas rodadas.

```text
          p1  p2  p3  p4
início    a   b   c   d
rodada 1  X   a   c   d    p1 alcança só p2 e cai
rodada 2  X   X   a   d    p2 alcança só p3 e cai
rodada 3  X   X   a   a    p3 é correto e alcança p4
```

Parar depois da rodada 2 deixaria p3 com a e p4 com d, ambos vivos e corretos. Uma enumeração exaustiva, com estas mesmas entradas distintas, conta as execuções assim: no máximo f processos caem, e cada um escolhe uma rodada de crash. Um processo que cai na rodada que coordena também escolhe qualquer subconjunto dos outros 3 processos como destinatários, mortos ou não. Um processo que cai em qualquer outra rodada tem um único resultado. Isso dá:

```text
rodadas = 2:  180 execuções, 42 com desacordo
rodadas = 3:  424 execuções,  0 com desacordo
```

Das 42, em 36 p1 e p2 caem cada um na sua própria rodada, como no rastreamento acima. Nas outras 6, p1 cai no meio do broadcast enquanto p2 cai na rodada 1, antes da sua vez: a rodada 2 fica sem broadcast nenhum, e a divisão sobrevive.

### Exemplo 2: a cadeia, com n = 3, f = 1, uma rodada

O argumento pode ser executado mecanicamente. A decisão de um protocolo determinístico é função do que o processo viu, então ligue duas visões sempre que processos não falhos as tiverem na mesma execução. Visões ligadas precisam decidir igual. Para um protocolo de uma rodada há 104 execuções, e esta cadeia conecta a execução toda 0 à execução toda 1. Cada linha compartilha uma visão com a seguinte. As entradas aparecem na ordem p1, p2, p3, e "só pX ouve" significa que o processo que caiu entregou a sua última mensagem a pX e a mais ninguém.

```text
    entradas  crash                    compartilhado com a próxima linha
1   000       nenhum                   p2 vê p1=0, p3=0
2   000       p1, só p2 ouve           p3 vê p1 ausente, p2=0
3   100       p1, só p2 ouve           p2 vê p1=1, p3=0
4   100       p3, p1 e p2 ouvem        p1 vê p2=0, p3=0
5   100       p2, só p1 ouve           p3 vê p1=1, p2 ausente
6   110       p2, só p1 ouve           p1 vê p2=1, p3=0
7   110       p3, só p1 ouve           p2 vê p1=1, p3 ausente
8   111       p3, só p1 ouve           p1 vê p2=1, p3=1
9   111       nenhum (sem falhas)
```

A linha 1 precisa decidir 0 e a linha 9 precisa decidir 1, mas cada elo força igualdade, então não existe protocolo de uma rodada. A mesma verificação em outros tamanhos bate com o teorema, inclusive com a sua exceção:

```text
n=4, f=2, 2 rodadas: a cadeia existe, não há protocolo
n=4, f=2, 3 rodadas: sem cadeia (o protocolo com coordenador existe)
n=3, f=2, 2 rodadas: sem cadeia (n = f + 1, então f rodadas bastam)
```

### Exemplo 3: o mesmo protocolo quando o limite de tempo quebra

Rode n = 3, f = 1, portanto duas rodadas, numa rede real, e deixe que ninguém caia.

```text
início    p1=a  p2=b  p3=c
rodada 1  o broadcast de p1 chega depois de a rodada fechar: ignorado
rodada 2  p2 faz broadcast de b; p3 adota; a cópia de p1 atrasa
decisão   p1=a  p2=b  p3=b
```

Os três processos estão vivos e discordam. No modelo, o silêncio de p1 significaria que p1 caiu, e o valor dele não contaria. Fora do modelo, o mesmo silêncio não significa nada. O Paxos no mesmo cenário travaria, não divergiria.

## Equívocos Comuns e Armadilhas

- **"As f + 1 rodadas vêm do desenho com coordenador."** O limite vale para todo algoritmo quando n >= f + 2. O flooding paga as mesmas rodadas com mais mensagens.
- **"Um líder no modelo síncrono precisa ser eleito."** A escala o atribui. A eleição existe para resolver um problema que este modelo não tem: saber se o líder atual está vivo.
- **"Cada crash adiciona uma rodada."** O número de rodadas é fixo em f + 1. Um crash importa quando divide estimativas no meio do broadcast ou remove um coordenador cuja vez ainda não chegou, e as f + 1 vagas já pagam cada crash desse tipo.
- **"O limite vale para todo n."** Com n = f + 1, f rodadas bastam, como o Exemplo 2 confirma para n = 3 e f = 2.
- **"Tolerar f crashes com f + 1 processos torna isto melhor que o Paxos."** Esse número só vale enquanto o limite de tempo vale. O Exemplo 3 mostra uma violação de segurança com zero crashes.

## Resumo

Com limites de atraso conhecidos, uma mensagem ausente prova um crash, então o líder pode ser atribuído por escala. Um coordenador rotativo roda f + 1 rodadas, e o coordenador que nunca cai deixa todos os processos vivos com um único valor, que os coordenadores seguintes só podem repetir. Todo algoritmo precisa de f + 1 rodadas em alguma execução quando n >= f + 2, como mostra uma cadeia de indistinguibilidade. O modelo síncrono não precisa de maioria para tolerar t crashes, enquanto a sincronia parcial precisa de 2t + 1 processos e a assincronia não tem solução determinística. Essa diferença mede o que a certeza de tempo vale, e os protocolos assíncronos a pagam com quóruns em troca de uma segurança que sobrevive a qualquer atraso.

## Documentation Links

- [Dwork, Lynch & Stockmeyer: Consensus in the Presence of Partial Synchrony (JACM 1988)](https://groups.csail.mit.edu/tds/papers/Lynch/jacm88.pdf): a definição de sistemas síncronos e parcialmente síncronos, e a Tabela I com o mínimo de processadores por tipo de falha.
- [Aspnes: Notes on Theory of Distributed Systems](https://arxiv.org/abs/2001.04235): o livro livre cujo capítulo sobre acordo síncrono traz o flooding, o limite de f + 1 por cadeia de execuções, a condição n >= f + 2 e a história do resultado.
- [Chandra & Toueg: Unreliable Failure Detectors for Reliable Distributed Systems (JACM 1996)](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/p225-chandra.pdf): o paradigma do coordenador rotativo e os seus usos anteriores.
- [Dolev, Reischuk & Strong: Early Stopping in Byzantine Agreement (JACM 1990)](https://cris.huji.ac.il/en/publications/early-stopping-in-byzantine-agreement/): o resumo enuncia o limite min(t + 1, f + 2) e o limite t + 1 para acordo simultâneo.
- [Wang, Teo & Cao: Lower Bounds for Achieving Synchronous Early Stopping Consensus with Orderly Crash Failures (2005)](https://dspace.mit.edu/handle/1721.1/7425): o limite min(t + 1, f + 2) sobre decidir e parar, para crashes ordenados.
- [Abraham: Synchronous Consensus Lower Bound via Uncommitted Configurations (2019)](https://decentralizedthoughts.github.io/2019-12-15-synchrony-uncommitted-lower-bound): a prova para a frente do limite, seguindo Aguilera e Toueg.
- [Lamport: Paxos Made Simple (2001)](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf): as afirmações sobre eleição e segurança citadas na comparação com a referência.
