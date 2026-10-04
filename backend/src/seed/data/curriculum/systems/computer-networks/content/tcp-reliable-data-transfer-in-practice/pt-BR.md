---
version: 1.0
updatedAt: 2026-09-06
title: "A Transferência Confiável de Dados do TCP na Prática"
summary: "Como os princípios gerais de transferência confiável de dados se tornam o mecanismo de fato do TCP: confirmações cumulativas, retransmissão rápida com três ACKs duplicados e timeout adaptativo calculado a partir de uma estimativa contínua do tempo de ida e volta. Fórmulas reais, e não só o conceito de \"retransmita se estiver atrasado\"."
---
## Objetivos de Aprendizagem

- Explicar o uso de confirmações cumulativas pelo TCP, e o que "cumulativa" significa especificamente em termos de quais bytes um ACK confirma.
- Descrever a retransmissão rápida: o que três ACKs duplicados indicam, e por que o TCP reage a eles sem esperar um timeout.
- Explicar por que um intervalo de timeout fixo não consegue funcionar corretamente na faixa real de tempos de ida e volta da Internet, motivando a estimativa adaptativa do timeout.
- Percorrer a fórmula de média móvel exponencialmente ponderada que o TCP usa para estimar o RTT, e explicar por que uma média simples das amostras recentes é insuficiente.
- Conectar os mecanismos concretos deste conceito de volta ao enquadramento abstrato de Go-Back-N vs. Selective Repeat dos princípios de transferência confiável de dados: com qual dos dois o TCP real mais se parece, e onde ele difere?

## Contexto e Motivação

O three-way handshake, recém-coberto, estabelece uma conexão; este conceito cobre o que acontece pelo resto da vida dessa conexão: como o TCP de fato decide que um segmento se perdeu e precisa ser retransmitido, e como ele decide quanto esperar antes de concluir isso. A resposta real do TCP às duas perguntas é mais refinada que o esboço simples de "inicie um temporizador, retransmita se ele expirar" dos princípios de transferência confiável de dados: ele usa confirmações cumulativas junto com um atalho de retransmissão rápida que reage a um sinal forte de perda bem antes de qualquer temporizador expirar, e calcula o seu valor de timeout de forma adaptativa, a partir de medições reais e continuamente atualizadas do tempo de ida e volta, em vez de usar um único valor fixo que nunca poderia estar certo ao mesmo tempo para uma conexão na mesma cidade e para uma conexão do outro lado do mundo.

## Teoria Central

### Confirmações cumulativas

As confirmações do TCP são cumulativas: um ACK com número de confirmação `n` significa "recebi corretamente todo byte até o byte `n`, exclusive", e não meramente "recebi o segmento específico sobre o qual você está perguntando". Se os segmentos carregando os bytes de 1 a 500 e de 501 a 1000 chegam ambos corretamente, o ACK enviado é para o byte 1001, independentemente de um ou dois segmentos terem produzido esse estado. Isso tem uma consequência direta e importante para a perda: se o segmento carregando os bytes de 501 a 1000 se perde, mas um segmento posterior carregando os bytes de 1001 a 1500 chega, o receptor ainda só confirma até o byte 501 (o último byte que ele tem, em ordem); ele não consegue confirmar bytes que não recebeu em sequência, mesmo tendo recebido corretamente bytes posteriores.

### Retransmissão rápida: reagindo a ACKs duplicados

Quando o receptor recebe um segmento fora de ordem (como no exemplo do parágrafo anterior: os bytes de 1001 a 1500 chegando enquanto os de 501 a 1000 ainda faltam), ele reenvia um ACK para o byte 501 de novo: um ACK duplicado, já que o receptor já enviou exatamente esse mesmo número de confirmação uma vez antes. Se o remetente vê três ACKs duplicados para o mesmo byte em sequência (o ACK original mais dois duplicados, ou seja, três ACKs duplicados), isso é tratado como uma evidência forte de que um segmento específico se perdeu, já que significa que pelo menos dois segmentos chegaram com segurança depois do que falta, o que é improvável de acontecer por pura reordenação aleatória em vez de perda genuína. A retransmissão rápida do TCP reage a esse sinal imediatamente, retransmitindo o segmento que falta sem esperar que o seu temporizador expire, frequentemente bem mais rápido do que uma recuperação baseada em timeout seria, já que três ACKs duplicados podem chegar bem dentro de um único tempo de ida e volta.

### Por que um timeout fixo não consegue funcionar

A Internet conecta hosts que podem estar na mesma rede local (tempo de ida e volta abaixo de um milissegundo) ou em lados opostos do planeta (tempo de ida e volta de algumas centenas de milissegundos). Um único valor de timeout fixo não consegue estar certo para os dois: um timeout ajustado para o caso local dispararia retransmissões constantes e desnecessárias na conexão de longa distância (declarando perda para segmentos que simplesmente ainda estão em trânsito, dado o tempo de ida e volta real mais longo), enquanto um timeout ajustado para o caso de longa distância deixaria a conexão local esperando tempo demais para notar uma perda genuína. O TCP, em vez disso, mede o tempo de ida e volta para cada conexão individual e calcula o seu timeout de forma adaptativa a partir dessas medições.

### Estimativa adaptativa do RTT

O TCP amostra o tempo de ida e volta real (`SampleRTT`) de segmentos individuais e mantém uma estimativa suavizada, `EstimatedRTT`, atualizada a cada nova amostra via uma média móvel exponencialmente ponderada:

```text
EstimatedRTT = (1 - α) × EstimatedRTT + α × SampleRTT
```

com `α` tipicamente definido como 0,125 (dando às amostras recentes um peso significativo enquanto ainda suaviza o ruído de qualquer amostra isolada incomumente rápida ou lenta). O TCP também rastreia a *variabilidade* das amostras de RTT (`DevRTT`, uma medida de quanto o SampleRTT tende a se desviar do EstimatedRTT) e define o seu intervalo de timeout de fato como `EstimatedRTT + 4 × DevRTT`: uma margem mais larga quando o RTT tem flutuado muito recentemente, e uma margem mais apertada quando ele tem estado estável, em vez de usar o EstimatedRTT sozinho como timeout.

### Por que não simplesmente uma média simples

Uma média simples e sem ponderação de todas as amostras de RTT passadas responderia muito lentamente a uma mudança genuína e sustentada nas condições da rede (uma mudança de rota, um congestionamento súbito): uma média antiga construída a partir de centenas de amostras mal se moveria em resposta a um punhado de amostras novas mostrando um RTT real diferente. A média móvel exponencialmente ponderada, por contraste, sempre dá às amostras mais novas um peso proporcional fixo (`α`) em relação à estimativa existente, então ela acompanha uma mudança genuína e sustentada no RTT real de forma muito mais responsiva, enquanto ainda suaviza o ruído de qualquer amostra anômala isolada.

## Exemplos Resolvidos

### Exemplo 1: ACK cumulativo com uma chegada fora de ordem

Os bytes de 1 a 500 chegam e são confirmados (ACK=501). Depois chegam os bytes de 1001 a 1500 (os bytes de 501 a 1000 se perderam em trânsito). Depois chegam os bytes de 1501 a 2000.

```text
Depois que 1-500 chega:      ACK=501  (todos os bytes até 501 recebidos)
Depois que 1001-1500 chega:  ACK=501  (duplicado -- 501 ainda é o maior
                                        byte EM ORDEM recebido; 1001-1500
                                        está fora de ordem e não pode ser
                                        confirmado além de 501)
Depois que 1501-2000 chega:  ACK=501  (duplicado de novo -- mesma razão)
```

Três ACKs para o byte 501 em sequência (o original mais dois duplicados) é exatamente o sinal de três ACKs duplicados que dispara a retransmissão rápida: o remetente infere que os bytes de 501 a 1000 se perderam e os retransmite imediatamente, sem esperar um timeout.

### Exemplo 2: Calculando o EstimatedRTT com a fórmula EWMA

Começando com `EstimatedRTT = 100` ms, `α = 0,125`. Uma nova `SampleRTT` de 140 ms é medida.

```text
EstimatedRTT = (1 - 0,125) × 100 + 0,125 × 140
             = 0,875 × 100 + 0,125 × 140
             = 87,5 + 17,5
             = 105 ms
```

Uma única amostra mais alta (140 ms) empurra a estimativa para cima só de forma modesta (de 100 para 105 ms), em vez de saltar até 140: esse amortecimento é o efeito direto e pretendido de ponderar a nova amostra por só `α = 0,125`, protegendo a estimativa de reagir demais a uma medição ruidosa, enquanto ainda se move na direção certa.

### Exemplo 3: Comparando o timing da retransmissão rápida com o de um timeout

Uma conexão tem EstimatedRTT de 100 ms e um timeout calculado de aproximadamente 250 ms (o EstimatedRTT mais uma margem pelo DevRTT). Um segmento se perde, mas os dois segmentos enviados imediatamente depois dele chegam com sucesso e disparam ACKs duplicados.

```text
Caminho da retransmissão rápida: os três ACKs duplicados podem chegar de
  volta ao remetente aproximadamente um tempo de ida e volta depois do
  segmento perdido (≈100 ms), já que só exigem que mais dois segmentos
  sejam enviados, recebidos e confirmados.

Caminho do timeout (se a retransmissão rápida não existisse): o remetente
  precisaria esperar o intervalo completo de timeout de ≈250 ms antes de
  concluir que o segmento se perdeu e retransmiti-lo.
```

A retransmissão rápida consegue se recuperar deste tipo específico de perda mais de duas vezes mais rápido do que esperar um timeout: uma diferença real e quantificável que importa diretamente para a vazão em qualquer conexão que sofra perdas ocasionais.

## Equívocos Comuns e Armadilhas

- **"Um ACK duplicado sempre significa que um segmento específico se perdeu."** Um único ACK duplicado também pode resultar da reordenação comum da rede entregando um segmento fora de ordem sem nenhuma perda de fato. É exatamente por isso que o TCP espera *três* ACKs duplicados (um sinal muito mais forte, embora não absoluto, de perda genuína) em vez de reagir a apenas um.
- **"O TCP confirma cada segmento individualmente, pelo número do segmento."** O número de confirmação do TCP é cumulativo e orientado a bytes: ele nomeia o próximo byte que o receptor espera em sequência, e não a identidade de um segmento específico, e é exatamente por isso que uma chegada fora de ordem produz uma duplicata do ACK anterior em vez de uma confirmação nova e distinta.
- **"Um timeout mais longo é sempre mais seguro que um mais curto."** Um timeout longo demais atrasa a retransmissão legítima depois de uma perda real, prejudicando a vazão; um timeout curto demais dispara retransmissões desnecessárias para segmentos que simplesmente ainda estão em trânsito. O timeout adaptativo baseado no DevRTT existe justamente para encontrar um valor calibrado pela variabilidade real e atualmente observada de cada conexão, em vez de errar permanentemente para qualquer um dos extremos.
- **"A fórmula EWMA trata todas as amostras passadas por igual."** Não trata: cada nova amostra é ponderada por `α` em relação à estimativa acumulada, o que significa que a influência das amostras mais antigas decai geometricamente com o tempo. É uma escolha de projeto deliberada, que favorece a responsividade a mudanças genuínas e sustentadas em vez da precisão histórica estrita.

## Resumo

As confirmações cumulativas do TCP confirmam "tudo até este byte, em ordem" em vez de confirmar segmentos individuais, o que significa que uma chegada fora de ordem produz uma duplicata da confirmação anterior em vez de uma nova, e três dessas duplicatas em sequência (três ACKs duplicados) são tratadas como um sinal forte de perda, disparando a retransmissão rápida bem antes que qualquer temporizador expire. Como o tempo de ida e volta varia enormemente entre conexões reais, o TCP calcula o seu timeout de retransmissão de forma adaptativa, a partir de uma média móvel exponencialmente ponderada dos tempos de ida e volta medidos (EstimatedRTT) mais uma margem baseada na variabilidade (DevRTT), em vez de usar um único valor fixo que nunca poderia estar certo tanto para uma conexão na mesma cidade quanto para uma transcontinental. Juntas, a retransmissão rápida e a estimativa adaptativa do timeout são a instanciação concreta e do mundo real, pelo TCP, da maquinaria abstrata de números de sequência e temporizadores introduzida nos princípios de transferência confiável de dados: mais próximas em espírito do rastreamento por segmento do Selective Repeat do que da retransmissão em bloco do Go-Back-N, embora o projeto de ACK cumulativo do TCP signifique que ele não bufferiza e confirma seletivamente dados fora de ordem de forma tão limpa quanto um protocolo Selective Repeat de livro-texto faria.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão dos ACKs cumulativos, da retransmissão rápida e da estimativa adaptativa de RTT/timeout do TCP.
