---
version: 1.0
updatedAt: 2026-11-04
title: "Detectores de Falha"
summary: "Detectores de falha não confiáveis como definidos por Chandra e Toueg, suas classes de completude e precisão, o detector mais fraco para consenso, e detectores por heartbeat e phi-accrual na prática."
---
## Objetivos de Aprendizagem

- Definir um detector de falha não confiável como Chandra e Toueg, por completude e precisão, e nomear as oito classes.
- Explicar por que as oito classes colapsam em quatro, e o que cada uma das quatro resolve e com qual limite de falhas.
- Acompanhar como o consenso com ◇S mantém a segurança sob suspeitas erradas, usando os quóruns reais.
- Enunciar o resultado do detector mais fraco de Chandra, Hadzilacos e Toueg, e relacionar Ω à eleição de líder.
- Calcular φ a partir de uma janela de heartbeats e explicar por que a abordagem accrual separa monitoramento de decisão.

## Contexto e Motivação

`why-distributed-systems-are-hard-partial-failure-and-no-shared-state` mostrou que o silêncio não separa uma máquina que caiu de uma máquina lenta, e `the-flp-impossibility-result` transformou essa ambiguidade em teorema. Timeouts foram a saída prática, mas apareceram como um desvio do modelo, sem análise. Chandra e Toueg fizeram uma pergunta mais afiada: o que dá para resolver com um oráculo sobre falhas que erra, até infinitas vezes? A resposta trata o detector de falha como um módulo abstrato com propriedades enunciadas, separado de qualquer timeout. `reconfiguration-changing-membership-in-paxos-and-raft` supôs que alguém pede uma mudança, e a detecção é uma das entradas desse pedido.

## Teoria Central

### Um oráculo que pode errar

Cada processo tem um módulo local que devolve o conjunto de processos dos quais ele suspeita no momento. Um módulo pode acrescentar um processo, depois retirá-lo, e repetir isso para sempre, e módulos em processos diferentes podem discordar a qualquer momento. O resto do modelo assíncrono não muda. O artigo insiste nessa abstração e pede que o leitor "refrain from thinking of failure detectors in terms of specific time-out mechanisms": algoritmos e provas se apoiam só nas propriedades.

### Completude e precisão

A completude limita crashes não percebidos, e a precisão limita suspeitas falsas. Nenhuma delas sozinha serve: um detector que suspeita de todos para sempre é trivialmente completo e não informa nada.

```text
Completude forte: em algum momento todo processo que caiu passa a ser
                  suspeito para sempre por TODO processo correto.
Completude fraca: ... por ALGUM processo correto.

Precisão forte:            nenhum processo é suspeito antes de cair.
Precisão fraca:            algum processo correto nunca é suspeito.
Precisão forte eventual:   depois de algum momento, nenhum processo
                           correto é suspeito por um processo correto.
Precisão fraca eventual:   depois de algum momento, algum processo
                           correto nunca é suspeito por um processo correto.
```

Duas propriedades de completude vezes quatro de precisão dão oito classes:

| | Precisão forte | Precisão fraca | Forte eventual | Fraca eventual |
|---|---|---|---|---|
| **Completude forte** | P (Perfect) | S (Strong) | ◇P | ◇S |
| **Completude fraca** | Q | W (Weak) | ◇Q | ◇W |

### De oito classes para quatro

Uma redução simples transforma completude fraca em forte e preserva a precisão. Todo processo envia repetidamente seus suspeitos para todos. Ao receber `(q, suspects)`, um processo acrescenta `suspects` à sua saída e retira `q`, já que acabou de ouvir `q` (Exemplo 1). Cada classe da linha de baixo é então equivalente à de cima, e sobram P, S, ◇P e ◇S.

### O que cada classe compra

Com `f` o número máximo de crashes entre `n` processos:

- **S (e portanto P)** resolve consenso para qualquer `f < n`.
- **◇S (e portanto ◇P)** resolve consenso somente se `f < ⌈n/2⌉`, ou seja, com uma maioria de processos corretos.
- Esse limite é justo. Nem ◇P resolve consenso com `f ≥ ⌈n/2⌉`. Divida os processos em dois e atrase todas as mensagens entre as metades até as duas decidirem, com cada metade suspeitando da outra até lá: cada metade precisa decidir como se a outra tivesse caído, e as duas podem decidir diferente.

O algoritmo com ◇S usa um coordenador rotativo: na rodada `r`, o coordenador é `(r mod n) + 1`. Ele junta `⌈(n+1)/2⌉` estimativas com timestamps, escolhe uma de maior timestamp e a envia. Cada processo adota o valor e responde ack, ou suspeita do coordenador e responde nack. Se todas as `⌈(n+1)/2⌉` respostas forem acks, o valor está travado e o coordenador faz reliable broadcast da decisão.

Neste algoritmo com ◇S, o detector afeta só a vivacidade. Se ele se comportar mal para sempre, os processos podem nunca decidir, mas nunca decidem diferente. Erros custam rodadas, não segurança (Exemplo 2).

### Por que isso não contradiz o FLP

Nenhum algoritmo implementa ◇W num sistema puramente assíncrono, já que isso resolveria o consenso e contradiria o FLP. O detector é uma suposição acrescentada, e diz com precisão o que precisa ser acrescentado. Ele pode ser construído onde vale sincronia parcial. Num modelo em que limites desconhecidos valem depois de um tempo global de estabilização também desconhecido, a Figura 10 de Chandra e Toueg implementa ◇P: envie "alive" periodicamente, suspeite no timeout e, ao ouvir um processo suspeito, retire-o da lista e aumente o timeout dele. Depois da estabilização, o timeout acaba passando do limite real. Na prática as propriedades não precisam valer para sempre, só por tempo suficiente para o algoritmo terminar.

### O detector mais fraco para consenso

◇W é necessário, ou só suficiente? Chandra, Hadzilacos e Toueg provaram em 1996 que qualquer detector usável para consenso, seja qual for o formato da saída, pode ser transformado em ◇W. Ele é portanto o mais fraco para consenso quando `n > 2f`. Se `n ≤ 2f`, qualquer detector que resolva consenso precisa ser estritamente mais forte. (A rigor, o resultado trata do detector mais fraco da classe ◇W, que Chandra e Toueg escrevem ◇W0.)

A prova passa por um detector chamado Ω. Ele devolve um processo de confiança, e existe um momento a partir do qual todos os processos corretos confiam no mesmo processo correto. Qualquer detector que resolva consenso pode ser transformado em Ω, e Ω em ◇W suspeitando de todos menos do processo de confiança. Ω parece a forma abstrata de um líder estável. Lamport, Malkhi e Zhou observam que o Paxos garante progresso só quando há um líder único, enquanto a segurança sobrevive a vários, que é a mesma divisão entre vivacidade e segurança. O timeout de eleição de um seguidor em `raft-leader-election` é uma suspeita concreta do líder, mas essa ligação aqui é analogia, não teorema.

### Heartbeats na prática

Hayashibara et al. usam duas das métricas de qualidade de serviço de Chen, Toueg e Aguilera: o tempo de detecção `T_D`, do crash até a suspeita permanente, e a taxa média de erros `λ_M`. O processo monitorado envia um heartbeat a cada `Δi`, e o monitor suspeita depois de um timeout `Δto`. Um timeout curto detecta rápido e erra muito, e um longo faz o contrário. Detectores adaptativos estimam a próxima chegada a partir de amostras recentes.

### O detector φ accrual

Hayashibara, Défago, Yared e Katayama (2004) argumentam que uma saída booleana dificulta atender ao mesmo tempo várias aplicações com requisitos diferentes. Um detector accrual devolve um nível de suspeita numa escala contínua, e cada aplicação escolhe o próprio limiar, ou vários: no exemplo deles, o mestre para de enviar tarefas novas num nível baixo, reenvia as tarefas num nível moderado e libera recursos num nível alto. O monitoramento fica separado da interpretação.

O detector φ mantém uma janela de intervalos entre heartbeats, assume uma distribuição normal com a média µ e a variância σ² da janela, e calcula:

```text
P_later(t) = probabilidade de o próximo heartbeat chegar mais de
             t depois do anterior = 1 - F(t)
φ(t_now)   = -log10( P_later(t_now - T_last) )
```

Suspeitar com `φ ≥ Φ` significa uma chance de erro de cerca de 10% com Φ = 1, 1% com Φ = 2 e 0,1% com Φ = 3. Accrual é uma interface, não uma fuga do FLP: o artigo mostra como construir ◇P em cima dela com limiares móveis, e ressalta que nenhum dos dois pode ser implementado de forma determinística em todo sistema assíncrono.

O principal achado do artigo é que essa flexibilidade não custa nada significativo: reproduzido sobre o mesmo trace, o φ se saiu tão bem quanto o detector de Chen, um pouco melhor na faixa agressiva e um pouco pior na conservadora, e melhor que o de Bertier, projetado para LANs. Os autores avisam para não exagerar a diferença com Chen. O trace veio de uma semana entre Japão e Suíça, com 5.845.712 heartbeats enviados por UDP e 5.822.521 recebidos (cerca de 0,4% de perda). A taxa de erros melhorou em dois degraus: de Φ = 0,5 a 2, quando heartbeats atrasados deixam de disparar suspeitas, e com Φ em [8; 12], quando heartbeats perdidos isolados deixam também.

**Livro vs hoje:** a documentação atual de cluster do Akka ainda calcula φ com uma distribuição normal, usa limiar padrão 8 e sugere 12 em ambientes de nuvem como o Amazon EC2. Ela acrescenta uma margem, `acceptable-heartbeat-pause`, para pausas de garbage collection e falhas transitórias de rede, e diz que ajustar essa margem costuma bastar.

## Exemplos Resolvidos

### Exemplo 1: completude fraca vira forte

Quatro processos rodam a redução. p4 cai na rodada 2. Só o detector local de p1 suspeita de p4, da rodada 3 em diante. O detector local de p3 suspeita errado de p2 apenas na rodada 3.

```text
rodada  saída em p1     saída em p2     saída em p3
  2     {}              {}              {}
  3     {p2,p4}         {p2,p4}         {p2,p4}
  4     {p4}            {p4}            {p4}
  5     {p4}            {p4}            {p4}
```

Todos adotam a suspeita de p1 sobre p4, então a completude agora é forte. A suspeita falsa sobre p2 se espalha na rodada 3 e some na rodada 4, porque cada mensagem de p2 retira p2. p4 não envia nada, então continua na lista. (A escala de execução foi inventada para este exemplo.)

### Exemplo 2: suspeitas erradas custam rodadas, não segurança

O algoritmo com ◇S e `n = 5`, então `f ≤ 2` e o quórum é 3. Os valores iniciais são a, b, c, d, e para p1 a p5. A escala foi inventada para este exemplo; as regras são as da Figura 6 do artigo.

```text
Rodada 1, coordenador p2. Junta p1, p2, p3 (todos com timestamp 0), escolhe b.
  p1, p2, p3 respondem ack e adotam b com timestamp 1: b está TRAVADO.
  p2 cai antes de difundir a decisão. Ninguém decidiu.

Rodada 2, coordenador p3. Os subconjuntos de 3 sobreviventes:
  {p1,p3,p4}  {p1,p3,p5}  {p1,p4,p5}  {p3,p4,p5}
  Todos encontram o conjunto de acks {p1,p2,p3}. Na verdade os 10
  subconjuntos de 3 dos 5 processos encontram, já que só {p4,p5} fica fora dele.
  p3 junta {p3,p4,p5}: (b,ts 1), (d,ts 0), (e,ts 0). Escolhe b, forçado.
  p5 suspeita falsamente de p3 e responde nack. Respostas: ack, ack, nack. Sem decisão.

Rodada 3, coordenador p4. Junta p3 (b,2), p4 (b,2), p5 (e,0). Escolhe b.
  p3, p4, p5 respondem ack. p4 difunde a decisão: todo processo correto decide b.
```

A suspeita errada desperdiçou a rodada 2 e não mudou nada no valor. Quem protegeu foi a sobreposição dos subconjuntos de 3.

### Exemplo 3: o mesmo φ em duas redes

Duas janelas inventadas de intervalos entre chegadas, ambas com média de 100 ms:

```text
estável:  100 105 95 102 98 100 110 90 103 97    σ = 5,25 ms
instável: 100 160 40 130 70 150 50 120 80 100    σ = 38,5 ms
```

```text
Tempo desde o último heartbeat   120 ms   150 ms   200 ms   300 ms
φ no enlace estável                4,2     21,1     80,4    316,7
φ no enlace instável               0,5      1,0      2,3      7,0

Timeout equivalente a Φ              1        3        8
enlace estável (ms)                106,7    116,2    129,5
enlace instável (ms)               149,3    218,9    315,9
```

O mesmo Φ = 8 significa 130 ms num enlace e 316 ms no outro, que é a escala dinâmica descrita no artigo. Agora tome uma janela com dezenove intervalos de 100 ms e um de 200 ms (um heartbeat perdido): µ = 105, σ = 21,8. Um silêncio de 200 ms agora dá φ = 5,2, e não 80,4. A memória de uma perda passada muda o veredito, e uma janela sem nenhuma perda reage a um único heartbeat perdido como se o processo estivesse certamente morto.

## Equívocos Comuns e Armadilhas

- **"Um detector não confiável significa um protocolo inseguro."** Não no algoritmo com ◇S: nele o detector só afeta a terminação, o Exemplo 2 mostra uma suspeita errada custando uma rodada, e a segurança vem da sobreposição de quóruns. O algoritmo com S é diferente. Ele não tem quóruns, e seu acordo depende de um processo correto que de fato nunca é suspeito. Com `n = 2` e cada processo suspeitando do outro desde o início, nenhum espera, e cada um decide o próprio valor.
- **"◇P é mais forte, então tolera mais falhas que ◇S."** Os dois precisam de uma maioria de processos corretos. O que tira a exigência de maioria é a precisão perpétua, não uma precisão eventual mais forte.
- **"Chandra e Toueg provam que heartbeats implementam ◇P."** Só sob sincronia parcial. Num sistema puramente assíncrono, timeouts prematuros podem se repetir para sempre.
- **"Φ = 8 significa um erro em 10^8."** Essa leitura assume que o modelo normal se ajusta aos dados. O próprio trace do artigo teve rajadas de perda de até 1.093 heartbeats, e o Exemplo 3 mostra como φ depende do que a janela já viu.

## Resumo

Chandra e Toueg trocam timeouts por um oráculo abstrato definido por completude e precisão, com oito classes que se reduzem a quatro. S resolve consenso com qualquer número de crashes, e ◇S resolve com uma maioria correta, limite que vale até para ◇P. No algoritmo com ◇S, o detector influencia só a vivacidade, já que a sobreposição de quóruns mantém as decisões seguras. Chandra, Hadzilacos e Toueg mostram que ◇W, equivalente ao líder eventual Ω, é o detector mais fraco para consenso quando `n > 2f`. Heartbeats com timeouts crescentes implementam ◇P sob sincronia parcial. O detector φ accrual transforma o histórico de heartbeats num nível contínuo de suspeita e deixa a escolha do limiar para cada aplicação.

## Documentation Links

- [Chandra and Toueg (1996): Unreliable Failure Detectors for Reliable Distributed Systems](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/p225-chandra.pdf): as oito classes, as reduções, os algoritmos de consenso para S e ◇S, o limite inferior e a implementação sob sincronia parcial.
- [Chandra, Hadzilacos, and Toueg (1996): The Weakest Failure Detector for Solving Consensus](https://courses.csail.mit.edu/6.895/fall02/papers/Chandra/jacm96.pdf): a definição de Ω e a prova de que ◇W é necessário.
- [Hayashibara, Défago, Yared, and Katayama (2004): The φ Accrual Failure Detector](https://dspace.jaist.ac.jp/dspace/bitstream/10119/4784/1/IS-RR-2004-010.pdf): o relatório técnico com a abstração accrual, o cálculo de φ e o experimento entre Japão e Suíça.
- [Lamport, Malkhi, and Zhou (2010): Reconfiguring a State Machine](https://lamport.azurewebsites.net/pubs/reconfiguration-tutorial.pdf): seção 3.1.3, sobre o Paxos precisar de um líder único para o progresso, mas não para a segurança.
- [Akka documentation: Phi Accrual Failure Detector](https://doc.akka.io/libraries/akka-core/current/typed/failure-detector.html): uma implementação atual, com as configurações de limiar e margem.
