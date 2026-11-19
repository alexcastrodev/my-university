---
title: "Snapshots distribuídos: determinando estados globais de sistemas distribuídos"
summary: Chandy e Lamport mostram como processos sem relógio compartilhado podem registrar o próprio estado e o estado dos canais, usando mensagens marcadoras, de modo que o estado global registrado seja significativo, e aplicam isso à detecção de propriedades estáveis como terminação e deadlock.
researchArea: Sistemas distribuídos
keywords: snapshots distribuídos, estado global, marcadores, detecção de propriedades estáveis, detecção de terminação, detecção de deadlock, checkpointing
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo apresenta um algoritmo pelo qual um processo de um sistema distribuído determina um estado global do sistema durante uma computação. Muitos problemas de sistemas distribuídos podem ser formulados como o problema de detectar estados globais. Por exemplo, o algoritmo de detecção de estado global ajuda a resolver uma classe importante de problemas: a detecção de propriedades estáveis. Uma propriedade estável é aquela que persiste: depois que se torna verdadeira, permanece verdadeira. Exemplos de propriedades estáveis são "a computação terminou", "o sistema está em deadlock" e "todos os tokens de um anel de tokens desapareceram". O problema da detecção de propriedades estáveis é o de criar algoritmos para detectar uma dada propriedade estável. A detecção de estado global também pode ser usada para checkpointing.

## Visão geral

Em 1985, a pergunta "qual é o estado de um sistema distribuído agora?" não tinha resposta limpa, porque nenhum processo enxerga os outros e não existe relógio comum. O artigo registra que Gligor e Shattuck haviam afirmado que muitos algoritmos publicados de detecção de deadlock e de terminação eram incorretos e impraticáveis, e sugere que a causa é que as relações entre estados locais dos processos, estados globais do sistema e pontos de uma computação não eram bem entendidas. Definir essas relações é uma das contribuições declaradas.

Ele se apoia em [Tempo, relógios e a ordenação de eventos](/papers/lamport-time-clocks-ordering-of-events), que o artigo cita para a visão de computações como conjuntos parcialmente ordenados, mas não usa relógios lógicos: o algoritmo precisa apenas da ordem das mensagens em cada canal. A página de publicações do próprio Leslie Lamport descreve o algoritmo como uma aplicação direta das ideias básicas desse artigo anterior.

A imagem do artigo é a de fotógrafos que registram um céu cheio de pássaros migrando. As fotos não podem ser tiradas no mesmo instante e não podem perturbar a cena, mas a composição final precisa ser "significativa". A tarefa do artigo é definir "significativa" e dizer como tirar as fotos.

Vale conhecer antes: a ideia de evento, a visão de concorrência por happened-before e a diferença entre uma propriedade de um processo e uma propriedade do sistema inteiro.

## Contribuição

- **Um modelo.** Um conjunto finito de processos e canais, descrito como um grafo dirigido. Os canais têm buffers infinitos, não têm erros e entregam as mensagens na ordem de envio, com atraso arbitrário mas finito. Um processo é um conjunto de estados, um estado inicial e eventos atômicos, cada um alterando o processo e no máximo um canal. Um estado global é o conjunto de todos os estados de processos e de canais.
- **Um requisito.** O algoritmo de snapshot roda sobre a computação original e não pode alterá-la. Um processo só pode registrar o próprio estado e as mensagens que envia e recebe.
- **O algoritmo de marcadores.** Regra de envio: depois de registrar o estado, e antes de enviar outras mensagens por um canal, o processo envia um marcador em cada canal de saída. Regra de recebimento: ao receber um marcador por um canal, se o processo ainda não registrou o estado, ele o registra e registra esse canal como vazio; caso contrário, registra o canal como as mensagens recebidas por ele depois do próprio registro e antes do marcador.
- **Um teorema de correção.** O estado registrado S* é alcançável a partir do estado global em que o algoritmo começou, e o estado em que ele terminou é alcançável a partir de S*.
- **Uma aplicação.** Detecção de propriedades estáveis, com detecção de terminação e de deadlock como casos particulares.

## Metodologia

O artigo é uma derivação e uma prova, sem implementação nem medição. O Exemplo 3.1 usa um sistema de "conservação de um único token" com dois processos e dois canais. Se o estado do processo p é registrado antes de p enviar o token, mas o canal é registrado depois do envio, o estado composto mostra dois tokens, o que é inalcançável. Registrar o canal antes do envio e p depois mostra nenhum. O artigo transforma isso em condições de contagem: sendo n e n' as mensagens enviadas pelo canal antes de o remetente e o canal serem registrados, e m e m' as recebidas antes de o destinatário e o canal serem registrados, a consistência exige n = n' e m = m'. Como n' >= m', segue que n >= m. O estado registrado do canal é, portanto, as mensagens enviadas antes do registro do remetente menos as recebidas antes do registro do destinatário, e o marcador é o mecanismo que permite ao destinatário encontrar essa fronteira.

O Teorema 1 é provado reorganizando a computação real. Um evento é pré-registro se seu processo ainda não registrou o estado, e pós-registro caso contrário. Se um evento pós-registro precede imediatamente um evento pré-registro, eles estão em processos diferentes, o segundo não pode receber o que o primeiro enviou (o marcador, junto com a entrega FIFO, tornaria o segundo também pós-registro), e portanto os dois podem ser trocados sem mudar os estados. Trocas repetidas produzem uma computação em que todos os eventos pré-registro vêm primeiro, e o estado global entre os dois grupos é S*. O Exemplo 4.1 faz essa troca num traço concreto.

## Resultados

- **O estado registrado não precisa ter ocorrido.** No Exemplo 2.2 o algoritmo começa no estado global S0 e termina em S3. O S* registrado tem p no estado A, q no estado D, o canal c vazio e o canal c' contendo a mensagem M'. Ele não é igual a nenhum entre S0, S1, S2 e S3. O artigo pergunta "de que serve o algoritmo se o estado global registrado nunca ocorreu?" e responde com o Teorema 1.
- **Teorema 1.** Se o algoritmo começa no estado global S_a e termina em S_b durante uma computação, existe outra computação que permuta apenas os eventos entre esses dois pontos, coincide com a original fora deles e passa por S* em algum ponto entre eles. Logo S* é alcançável a partir de S_a, e S_b é alcançável a partir de S*. O artigo não afirma que o sistema real passou por S*.
- **Terminação.** O algoritmo termina em tempo finito se nenhum marcador ficar para sempre num canal e todo processo registrar o estado em tempo finito. Num grafo fortemente conexo, um único iniciador espontâneo basta. A coleta das partes registradas fica para outros algoritmos, com um esquema simples de inundação esboçado para sistemas fortemente conexos.
- **Detecção de estabilidade.** Uma propriedade é estável se, sempre que vale num estado global, vale em todo estado alcançável a partir dele. O algoritmo registra S* e faz definite := γ(S*), onde γ é a propriedade. A saída satisfaz: se γ vale quando o algoritmo começa, então definite é verdadeiro; se definite é verdadeiro, então γ vale quando o algoritmo termina. Assim, definite = true é uma afirmação sobre o fim, e definite = false só diz que a propriedade não valia no início, não que seja falsa no fim. A correção usa a alcançabilidade nos dois sentidos mais a definição de estabilidade.
- **Fases.** O artigo observa que "o sistema está em deadlock" não é estritamente estável se o deadlock for desfeito e a computação recomeçar, e trata isso tomando "a k-ésima fase terminou" como a propriedade estável.

## Análise crítica

O artigo é curto e preciso sobre o que prova. Os pontos abaixo são limites do texto, seguidos de literatura posterior, marcada como tal.

- **O modelo exclui falhas.** Os canais não têm erros e são FIFO, e o modelo não prevê falha de processos. O artigo não discute processos que caem, mensagens perdidas ou reordenadas, nem o que um snapshot significa se um processo para antes de registrar. As palavras-chave mencionam checkpoint/restart e tolerância a falhas, mas o texto desenvolve apenas a detecção de propriedades estáveis.
- **Iniciação e coleta ficam em aberto.** O que faz um processo registrar espontaneamente é adiado e não retomado, e a coleta das partes registradas depende de trabalhos citados.
- **Buffers infinitos e topologia fixa.** O artigo chama os buffers infinitos de conveniência, admitindo buffers limitados se nenhum processo puder estourar um. Mudanças de composição não são tratadas.
- **Propriedades instáveis não têm garantia.** Para uma propriedade que pode voltar a ser falsa, um snapshot não diz nada confiável sobre o presente.
- **O custo não é analisado.** Não há contagem de marcadores além de um por canal, estudo de com que frequência tirar snapshots, nem avaliação de desempenho.

Literatura posterior (não faz parte do artigo de 1985). A página de publicações de Lamport acrescenta que o algoritmo nasceu de uma conversa com Chandy e que ele o considera uma aplicação direta de ideias do artigo dos relógios. A mesma página registra que nenhum dos autores se lembra do trabalho "On Partially-Ordered Event Models of Distributed Computations", citado aqui como submetido. Um uso para checkpointing em processamento de fluxos aparece em Carbone et al., "Lightweight Asynchronous Snapshots for Distributed Dataflows" (arXiv 1506.08603). Li apenas o resumo: ele diz que as abordagens existentes de snapshot global periódico podem travar a computação e persistir todos os registros em trânsito, e propõe o Asynchronous Barrier Snapshotting, que persiste só o estado dos operadores em topologias acíclicas e mantém um log mínimo de registros em dataflows cíclicos, implementado no Apache Flink. Como ele se posiciona em relação a este artigo não é coberto aqui.

## Pesquisas futuras

- Snapshots quando processos ou canais podem falhar, e checkpointing construído sobre estados globais registrados.
- Detecção de propriedades estáveis além de terminação e deadlock, e detecção mais barata para propriedades específicas.
- Problemas vizinhos de ordem e consistência: a [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) para serviços replicados e a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) para a correção de operações sobre objetos compartilhados, uma pergunta diferente da de observar um estado global.
- Sistemas de processamento de fluxos que precisam de recuperação consistente de estado, como o descrito em [O modelo Dataflow](/papers/dataflow-model-unbounded-out-of-order-data).
- Registrar snapshots sem parar a computação quando o estado dos canais é grande.
