---
version: 1.0
updatedAt: 2026-09-06
title: "Princípios de Transferência Confiável de Dados"
summary: "Construindo confiabilidade em cima de um canal não confiável a partir de princípios básicos (confirmações, números de sequência, temporizadores e retransmissão) e depois fazendo pipelining de vários pacotes em trânsito para ganhar vazão, com o Go-Back-N e o Selective Repeat como as duas estratégias reais para o que um receptor faz quando os pacotes chegam fora de ordem."
---
## Objetivos de Aprendizagem

- Explicar por que a transferência confiável de dados precisa ser construída em cima de um canal não confiável, em vez de presumida como uma propriedade que a camada de rede já fornece.
- Descrever os três blocos básicos a partir dos quais a transferência confiável de dados é construída: confirmações, números de sequência e temporizadores.
- Explicar o pipelining: enviar múltiplos pacotes antes de esperar a confirmação do primeiro, e por que ele é necessário para uma boa vazão em enlaces de atraso longo.
- Distinguir o Go-Back-N do Selective Repeat como duas respostas diferentes a "o que o receptor faz com pacotes fora de ordem", e enunciar o trade-off real de custo/benefício entre eles.
- Explicar por que estes princípios são desenvolvidos em abstrato aqui, antes de serem conectados ao mecanismo concreto de fato do TCP nos próximos vários conceitos.

## Contexto e Motivação

O conceito anterior estabeleceu que o TCP promete entrega confiável e em ordem, em cima de uma camada de rede que não promete nenhuma das duas. Este conceito desenvolve, a partir de princípios básicos, como essa promessa é de fato cumprida, ainda não na forma concreta e específica do TCP (isso vem a seguir), mas como um conjunto de técnicas gerais que se aplicam à transferência confiável de dados sobre *qualquer* canal não confiável, técnicas que Kurose & Ross desenvolvem incrementalmente como uma sequência de protocolos de sofisticação crescente. Entender primeiro o problema geral, antes da implementação específica do TCP, deixa claro quais partes do projeto do TCP são consequências inevitáveis do próprio problema de confiabilidade, e quais são escolhas de engenharia específicas do TCP.

## Teoria Central

### Os blocos básicos

Três mecanismos, trabalhando juntos, são o que torna possível a entrega confiável sobre um canal não confiável:

1. **Confirmações (ACKs).** O receptor envia uma mensagem de volta ao remetente confirmando que dados específicos foram recebidos corretamente. Sem alguma forma de retorno, o remetente não tem como saber se qualquer coisa que enviou de fato chegou.
2. **Números de sequência.** Cada unidade de dados é marcada com um número que identifica a sua posição no fluxo geral. Os números de sequência permitem ao receptor detectar duplicatas (se um ACK se perde e o remetente retransmite, o receptor consegue reconhecer a retransmissão pelo seu número de sequência) e permitem ao receptor reordenar dados que chegam fora de sequência.
3. **Temporizadores.** O remetente inicia um temporizador quando envia dados; se nenhuma confirmação chegar antes que o temporizador expire, o remetente presume que os dados (ou a sua confirmação) se perderam, e retransmite. Sem um temporizador, um remetente esperando por um ACK que genuinamente nunca vai chegar (porque os dados originais se perderam) simplesmente esperaria para sempre.

### Stop-and-wait: o mais simples, mas lento demais

O protocolo confiável mais simples envia um pacote, espera a sua confirmação e só então envia o próximo pacote. Isso funciona corretamente, mas desperdiça uma quantidade enorme de vazão potencial em qualquer enlace com tempo de ida e volta significativo: o remetente fica ocioso, esperando, durante quase todo o tempo de ida e volta depois de cada pacote, transmitindo só por uma fração minúscula do tempo disponível. Num enlace com um produto banda-atraso grande (o produto da taxa do enlace pelo seu atraso de propagação de ida e volta, já introduzido conceitualmente quando o atraso foi coberto), o stop-and-wait pode deixar a vasta maioria da capacidade real do enlace completamente sem uso.

### Pipelining: enviar múltiplos pacotes antes de esperar

A correção é o pipelining: permitir que múltiplos pacotes estejam em trânsito (enviados, mas ainda não confirmados) simultaneamente, em vez de esperar a confirmação de cada um antes de enviar o próximo. Isso mantém o enlace ocupado transmitindo dados novos durante o tempo de ida e volta que de outro modo seria gasto ocioso, esperando. O pipelining, porém, levanta imediatamente uma pergunta nova que o stop-and-wait nunca precisou responder: o que o receptor deve fazer se o pacote 3 se perder, mas os pacotes 4 e 5, enviados depois, chegarem com sucesso? Duas respostas reais e diferentes a esta pergunta definem duas famílias de protocolos nomeadas.

### Go-Back-N

No Go-Back-N, o receptor só aceita pacotes em ordem: o receptor descarta qualquer pacote que chegue fora de ordem (mesmo que tenha chegado corretamente) e só confirma o maior número de sequência em ordem que recebeu até agora. Se o pacote 3 se perde, os pacotes 4 e 5, mesmo tendo chegado corretamente, são descartados pelo receptor, porque o receptor só está disposto a entregar dados à aplicação em sequência estrita. Quando o temporizador do remetente para o pacote 3 expira, ele retransmite não só o pacote 3, mas todo pacote do 3 em diante (daí "volte N"), já que o remetente não pode ter certeza de que o receptor guardou algum deles. Isso é simples para o receptor (nenhum buffer de dados fora de ordem necessário) ao custo de uma retransmissão desperdiçada potencialmente significativa, especialmente com um pipeline grande e uma única perda cedo.

### Selective Repeat

No Selective Repeat, o receptor bufferiza os pacotes fora de ordem que chegam corretamente em vez de descartá-los, e confirma individualmente cada pacote recebido corretamente. Se o pacote 3 se perde, mas os pacotes 4 e 5 chegam com sucesso, o receptor bufferiza o 4 e o 5 e os confirma individualmente; quando o remetente retransmite só o pacote 3 (tendo detectado especificamente que a confirmação do pacote 3 nunca chegou), o receptor pode então entregar o 3, o 4 e o 5 à aplicação em ordem, sem precisar que o 4 e o 5 sejam reenviados. Isso é mais eficiente em termos de retransmissão (só o pacote de fato perdido é reenviado) ao custo de um receptor mais complexo, que precisa bufferizar e gerenciar potencialmente vários pacotes fora de ordem simultaneamente.

## Exemplos Resolvidos

### Exemplo 1: A capacidade desperdiçada do stop-and-wait, com números reais

Um enlace tem taxa de transmissão de 1 Gbps e tempo de ida e volta de 30 ms. Um remetente stop-and-wait transmite um pacote de 1.000 bytes (8.000 bits) e depois espera a sua confirmação antes de enviar o próximo.

```text
Tempo de transmissão de um pacote = 8.000 bits / 1.000.000.000 bits/s
                                   = 0,000008 segundos = 8 microssegundos

Tempo total por pacote (transmitir + esperar o ACK) ≈ 8 microssegundos
                                                       + 30 milissegundos
                                                     ≈ 30,008 milissegundos

Utilização = tempo de transmissão / tempo total
           = 8 microssegundos / 30.008 microssegundos
           ≈ 0,00027, ou cerca de 0,027%
```

O stop-and-wait usa aproximadamente 0,027% da capacidade real deste enlace: nos outros 99,97% do tempo, o enlace fica ocioso enquanto o remetente espera por uma confirmação que leva 30 ms de ida e volta para chegar. Esta é a justificativa concreta e numérica para o pipelining: sem ele, um enlace rápido com atraso de ida e volta significativo é quase inteiramente desperdiçado.

### Exemplo 2: Go-Back-N vs. Selective Repeat quando o pacote 3 se perde

O remetente transmite os pacotes de 1 a 5 num pipeline; o pacote 3 se perde em trânsito, os pacotes 1, 2, 4 e 5 chegam corretamente.

```text
Go-Back-N:
  O receptor aceita o 1 e o 2 (em ordem). O pacote 3 nunca chega. Os
  pacotes 4 e 5 chegam, mas são DESCARTADOS (fora de ordem -- o receptor
  está esperando o 3). O temporizador do remetente para o pacote 3 expira;
  o remetente retransmite os pacotes 3, 4 E 5 (tudo do pacote perdido em
  diante). Total retransmitido: 3 pacotes (3, 4, 5), mesmo que o 4 e o 5
  já tivessem chegado com sucesso uma vez.

Selective Repeat:
  O receptor aceita o 1 e o 2 (em ordem), e separadamente BUFFERIZA o 4 e
  o 5 (fora de ordem, mas recebidos corretamente), enviando ACKs
  individuais para cada um. O temporizador do remetente para o pacote 3
  expira; o remetente retransmite SÓ o pacote 3. O receptor agora tem o 3
  (que acabou de chegar), o 4 e o 5 (já bufferizados) e entrega os três,
  em ordem, à aplicação. Total retransmitido: 1 pacote (só o 3).
```

O mesmo único pacote perdido custa 3 retransmissões sob o Go-Back-N, mas só 1 sob o Selective Repeat: uma diferença real e quantificável em eficiência de retransmissão, ao custo da lógica mais complexa de buffer do lado do receptor do Selective Repeat.

### Exemplo 3: Por que um temporizador sozinho (sem números de sequência) não basta

Suponha um protocolo que usasse só temporizadores e confirmações, sem números de sequência. Um remetente transmite o pacote A, e o seu ACK atrasa (não se perde, só demora) além da expiração do temporizador. O remetente, sem ter recebido ACK a tempo, retransmite o A. Agora suponha que o ACK original de A finalmente chegue, seguido logo depois pelo ACK da cópia retransmitida de A. Sem um número de sequência que distinga "este é o pacote A" de "esta é uma duplicata", o receptor não tem como reconhecer que recebeu A duas vezes e, dependendo do que o protocolo faz com uma "segunda" chegada do que ele acha que são dados novos, poderia entregar o payload de A à aplicação duas vezes. Os números de sequência são o que permite ao receptor reconhecer uma retransmissão como uma duplicata de algo já recebido, em vez de dados genuinamente novos.

## Equívocos Comuns e Armadilhas

- **"Pipelining significa abrir mão da confiabilidade em troca de velocidade."** O pipelining muda como os pacotes são transmitidos (vários em trânsito ao mesmo tempo), mas não se a confiabilidade é alcançada: o Go-Back-N e o Selective Repeat são ambos protocolos totalmente confiáveis; eles diferem só em quão eficientemente se recuperam de perdas, e não em se garantem, no fim, a entrega.
- **"O Go-Back-N é simplesmente um protocolo pior que o Selective Repeat em todo aspecto."** A simplicidade do Go-Back-N (nenhum buffer fora de ordem necessário no receptor) é uma vantagem de engenharia real e legítima em contextos em que a simplicidade de implementação importa mais que minimizar o overhead de retransmissão. O trade-off é genuíno, e não unilateral.
- **"Um temporizador expirando sempre significa que os dados originais se perderam."** Um temporizador expirando significa que nenhuma confirmação chegou a tempo: isso pode significar que os dados originais se perderam, ou que os dados chegaram bem mas a sua confirmação se perdeu ou simplesmente atrasou além do timeout. O remetente não consegue distinguir esses casos só pelo timeout, e é exatamente por isso que os números de sequência são necessários para tratar corretamente uma possível entrega duplicada.
- **"Estes princípios são específicos do TCP."** Eles são princípios gerais de transferência confiável de dados que se aplicam a qualquer protocolo construído sobre um canal não confiável. O TCP é uma instanciação concreta e do mundo real deles (desenvolvida nos próximos vários conceitos), mas os mesmos blocos básicos (ACKs, números de sequência, temporizadores, pipelining e uma escolha entre a recuperação de perdas no estilo Go-Back-N e no estilo Selective Repeat) se repetem em outros protocolos confiáveis, inteiramente fora das redes.

## Resumo

A transferência confiável de dados sobre um canal não confiável é construída a partir de três ferramentas básicas: confirmações (retorno de que os dados chegaram), números de sequência (distinguindo dados novos de duplicatas retransmitidas, e permitindo a reordenação) e temporizadores (detectando um ACK que nunca chega, como quer que isso tenha acontecido). O stop-and-wait, o protocolo correto mais simples, desperdiça uma fração enorme da capacidade de um enlace em qualquer conexão com atraso de ida e volta significativo, o que motiva o pipelining: permitir múltiplos pacotes não confirmados em trânsito simultaneamente. O pipelining levanta a pergunta do que um receptor faz com chegadas fora de ordem depois de uma perda: o Go-Back-N descarta qualquer coisa fora de ordem e retransmite tudo do pacote perdido em diante (receptor simples, mais retransmissão); o Selective Repeat bufferiza as chegadas fora de ordem e retransmite só o pacote específico perdido (mais eficiente em retransmissão, receptor mais complexo). Estes são princípios gerais, desenvolvidos independentemente de qualquer protocolo específico; o próximo conceito os conecta diretamente ao mecanismo concreto de fato do TCP.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o desenvolvimento incremental do livro-texto padrão dos protocolos de transferência confiável de dados (do rdt1.0 ao rdt3.0, depois pipelining, Go-Back-N e Selective Repeat).
