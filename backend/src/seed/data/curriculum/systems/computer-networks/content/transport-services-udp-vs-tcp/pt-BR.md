---
version: 1.0
updatedAt: 2026-09-06
title: "Serviços de Transporte: Multiplexação, UDP e TCP"
summary: "O trabalho da camada de transporte é a entrega de processo a processo em cima da entrega de host a host da camada de rede: multiplexação/demultiplexação via números de porta, e uma escolha real entre o UDP (mínimo indispensável, sem garantias) e o TCP (confiável, ordenado, com controle de congestionamento), com aplicações reais de cada lado dessa escolha."
---
## Objetivos de Aprendizagem

- Explicar o trabalho da camada de transporte (entrega de processo a processo) como algo distinto do trabalho da camada de rede (entrega de host a host), e explicar por que os dois são necessários.
- Explicar a multiplexação e a demultiplexação via números de porta, e como um socket é identificado por uma combinação de endereço IP e porta.
- Listar o modelo de serviço do UDP (sem confiabilidade, sem ordenação, sem controle de congestionamento) e explicar por que uma aplicação o escolheria deliberadamente mesmo assim.
- Listar o modelo de serviço do TCP (confiável, em ordem, orientado a conexão, com controle de congestionamento) e identificar aplicações reais que precisam de cada uma dessas garantias.
- Dada a descrição dos requisitos de uma aplicação, justificar uma escolha entre UDP e TCP.

## Contexto e Motivação

A camada de rede, coberta a partir de vários conceitos adiante, leva um datagrama de um host a outro host, mas um host roda muitos processos simultaneamente (um navegador, um cliente de e-mail, um jogo), e um datagrama que chega precisa alcançar o processo correto entre eles. Este é o primeiro trabalho da camada de transporte: a entrega de processo a processo, estendendo a entrega de host a host da camada de rede até a granularidade de uma aplicação individual. O segundo trabalho da camada de transporte, ao menos para o TCP, é muito mais envolvente: fornecer confiabilidade, ordenação e controle de congestionamento em cima de uma camada de rede que não garante nenhuma dessas coisas. A camada de rede, como estabelecido quando a comutação de pacotes foi introduzida, faz só uma tentativa de entrega de melhor esforço, sem garantia de que um pacote chegue, chegue uma vez só ou chegue na ordem em que foi enviado. Este conceito introduz os dois protocolos de transporte que esta disciplina desenvolve por completo: o UDP, que acrescenta essencialmente nada além da entrega de processo a processo, e o TCP, cujos mecanismos de confiabilidade e de congestionamento ocupam os próximos cinco conceitos.

## Teoria Central

### Entrega de processo a processo: portas e sockets

Todo segmento da camada de transporte carrega um número de porta de origem e um número de porta de destino, além do que quer que a camada de rede abaixo forneça (endereços IP de origem e de destino). Um socket (o ponto final de fato do qual uma aplicação lê e no qual escreve) é identificado pela combinação de um endereço IP com um número de porta (para o TCP, uma quádrupla completa de IP de origem, porta de origem, IP de destino e porta de destino identifica uma conexão específica). Quando um segmento chega a um host, a camada de transporte usa essa informação de endereçamento para demultiplexá-lo: entregar o seu payload ao socket correto e, portanto, ao processo correto, entre potencialmente muitos processos rodando naquele host simultaneamente. A multiplexação é a operação inversa no remetente: reunir dados de múltiplos sockets e passar cada um, marcado com a sua própria informação de porta, para a camada de rede.

### UDP: o mínimo indispensável

O UDP (User Datagram Protocol) fornece essencialmente nada além da multiplexação/demultiplexação (via portas) e de um checksum básico e opcional para detecção de erros. Ele não fornece confiabilidade (um datagrama UDP pode ser perdido sem notificação nem ao remetente nem ao receptor), nem garantia de ordenação (os datagramas podem chegar fora da ordem em que foram enviados), nem estabelecimento de conexão (um remetente UDP pode simplesmente começar a enviar datagramas a um destino sem handshake prévio), nem controle de congestionamento (um remetente UDP pode transmitir na taxa que a aplicação escolher, sem recuar em resposta ao congestionamento da rede). Isso soa, à primeira vista, como um protocolo pior que o TCP em todo aspecto, mas é um ponto de projeto real e deliberado que as aplicações genuinamente escolhem.

### TCP: confiabilidade, ordenação e controle de congestionamento

O TCP (Transmission Control Protocol) fornece entrega confiável, em ordem, de fluxo de bytes entre dois processos: nenhum byte é perdido (ou, se perdido, ele é retransmitido até chegar), nenhum byte chega fora da ordem em que foi enviado (ou, se chegar, ele é bufferizado e reordenado antes de ser entregue à aplicação), e o TCP adicionalmente fornece controle de congestionamento, reduzindo ativamente a sua própria taxa de envio em resposta ao congestionamento detectado na rede. O TCP também é orientado a conexão: antes que qualquer dado de aplicação seja trocado, um three-way handshake (coberto no próximo conceito) estabelece uma conexão entre os dois pontos finais, e a conexão é explicitamente encerrada quando a comunicação termina.

### Por que uma aplicação escolheria o UDP mesmo assim

Aplicações de tempo real (chamadas de voz, vídeo ao vivo, alguns jogos multiplayer) frequentemente preferem o UDP especificamente porque o mecanismo de confiabilidade do TCP, a retransmissão, é fundamentalmente conflitante com a entrega em tempo real: se um pacote de voz se perde, retransmiti-lo e esperar que ele chegue é frequentemente pior para a experiência do usuário do que simplesmente pular o áudio perdido e seguir em frente, já que um pacote de voz retransmitido mas atrasado é quase inútil quando a conversa já passou daquele momento. De forma parecida, o controle de congestionamento do TCP pode estrangular a taxa de um remetente de forma imprevisível em resposta às condições da rede, o que é indesejável para uma aplicação que precisa mais de uma taxa estável e previsível do que de confiabilidade perfeita. O DNS (já coberto) também tipicamente usa UDP, por uma razão diferente: o overhead de um estabelecimento completo de conexão TCP para uma única troca pequena de consulta e resposta é considerado desnecessário no caso comum.

### Por que a maioria das aplicações escolhe o TCP

Aplicações em que a corretude importa mais que uma taxa estritamente previsível (transferência de arquivos, e-mail, a maior parte do tráfego web via HTTP) precisam que todo byte chegue, chegue exatamente uma vez e chegue em ordem; uma página web com bytes silenciosamente faltando ou embaralhados está simplesmente quebrada, ao contrário de uma chamada de voz que tolera uma palavra perdida ocasional. As garantias de confiabilidade e de ordenação do TCP são exatamente o que essas aplicações precisam, e elas aceitam o atraso variável do TCP (a retransmissão leva tempo) e a redução de taxa sensível ao congestionamento como o custo da corretude.

## Exemplos Resolvidos

### Exemplo 1: Demultiplexação com uma quádrupla concreta

Um host está rodando um servidor web (escutando na porta 80) e tem, simultaneamente, uma conexão aberta com um servidor DNS (usando a porta 53) de uma busca anterior. Um segmento chega:

```text
IP de origem: 203.0.113.5     IP de destino: o IP deste host
Porta de origem: 51222         Porta de destino: 80
```

A camada de transporte do host examina a porta de destino (80) e entrega o payload deste segmento ao processo escutando na porta 80 (o servidor web), independentemente de qualquer outro tráfego chegando simultaneamente para a porta 53. Para o TCP especificamente, a quádrupla completa (IP de origem, porta de origem, IP de destino, porta de destino) distingue esta conexão de qualquer outra conexão TCP que o mesmo servidor web possa ter aberta com clientes diferentes, ou até múltiplas conexões vindas do mesmíssimo endereço IP de cliente em portas de origem diferentes.

### Exemplo 2: Escolhendo UDP vs. TCP para três aplicações reais

```text
Aplicação              Escolha  Por quê
----------------------  -------  ------------------------------------------
Chamada de voz ao vivo  UDP      Um pacote de áudio atrasado e retransmitido
                                  é quase sem valor -- melhor pular um pacote
                                  perdido e manter a conversa andando numa
                                  taxa estável do que pausar para retransmitir.

Download de arquivo     TCP      Todo byte precisa chegar, corretamente e em
                                  ordem -- um byte corrompido ou faltando
                                  deixa o arquivo baixado quebrado, e não só
                                  imperfeito.

Consulta DNS            UDP      Uma única troca pequena de requisição/
                                  resposta; o overhead do estabelecimento de
                                  conexão do TCP é desnecessário para o caso
                                  comum de uma consulta caber num pequeno
                                  datagrama.
```

### Exemplo 3: O que a garantia do TCP de fato custa, concretamente

Considere uma conexão TCP em que o pacote 3 de 5 se perde em trânsito. O mecanismo de confiabilidade do TCP (desenvolvido nos conceitos a seguir) detecta essa perda e retransmite o pacote 3, e a aplicação receptora não vê o pacote 4 nem o 5 até que o pacote 3 tenha sido retransmitido e recebido com sucesso: o TCP bufferiza os pacotes 4 e 5, retendo-os da aplicação, especificamente para preservar a entrega em ordem. Uma aplicação baseada em UDP, recebendo os cinco datagramas equivalentes com o terceiro perdido, simplesmente receberia os datagramas 1, 2, 4, 5 (fora de ordem em relação à ausência do datagrama 3), imediatamente, sem esperar nada, porque o UDP não promete reordenar nem esperar por coisa alguma.

## Equívocos Comuns e Armadilhas

- **"O UDP é simplesmente uma versão inferior e mais antiga do TCP."** O UDP é um ponto de projeto deliberado para aplicações em que as garantias de confiabilidade e de ordenação do TCP trabalham ativamente contra os objetivos reais da aplicação (entrega estável em tempo real acima de corretude estrita). Ele não é menor, é diferente, escolhido para requisitos genuinamente diferentes.
- **"Um número de porta identifica um host."** Um número de porta identifica um processo específico (ou, mais precisamente, um socket) num host; um endereço IP identifica o próprio host. Os dois juntos identificam onde, especificamente, naquele host um segmento deve ser entregue.
- **"O TCP garante que uma mensagem chegue rápido."** O TCP garante que uma mensagem eventualmente chegue, corretamente e em ordem; ele não promete absolutamente nada sobre quão rápido, e na verdade pode introduzir um atraso significativo quando a retransmissão ou o controle de congestionamento entram em ação, que é precisamente por que aplicações de tempo real frequentemente preferem o UDP no lugar.
- **"A camada de transporte roteia pacotes pela rede."** O roteamento é inteiramente o trabalho da camada de rede, coberto a partir de vários conceitos adiante nesta disciplina; o trabalho da camada de transporte é a entrega de processo a processo em cima de qualquer entrega de host a host que a camada de rede já forneça, uma preocupação genuinamente diferente, de camada mais alta.

## Resumo

A camada de transporte estende a entrega de host a host da camada de rede até a entrega de processo a processo, usando números de porta para multiplexar e demultiplexar segmentos para o socket correto num host. O UDP fornece essencialmente nada além desse endereçamento (sem confiabilidade, sem ordenação, sem controle de congestionamento) e é escolhido deliberadamente por aplicações de tempo real e de baixo overhead (voz, vídeo, DNS) justamente porque as garantias do TCP trabalhariam contra as suas necessidades reais. O TCP fornece entrega de fluxo de bytes confiável, em ordem, orientada a conexão e com controle de congestionamento, ao custo de atraso variável por retransmissão e redução de taxa, e é a escolha certa para aplicações em que a corretude importa mais que o timing estrito (transferência de arquivos, e-mail, a maior parte do tráfego da Web). Os próximos cinco conceitos desenvolvem os mecanismos de fato do TCP (transferência confiável de dados, o handshake, retransmissão e estimativa de RTT, controle de fluxo e controle de congestionamento), cada um construído diretamente sobre o modelo de serviço estabelecido aqui.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão da multiplexação/demultiplexação da camada de transporte e dos modelos de serviço do UDP/TCP.
- [Stanford CS144: Lecture Schedule ("Transport & reliability")](https://www.scs.stanford.edu/10au-cs144/sched/): uma aula de um curso real que introduz o problema de confiabilidade da camada de transporte logo depois da camada de aplicação.
