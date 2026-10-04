---
version: 1.0
updatedAt: 2026-09-06
title: "A Borda da Rede, o Núcleo da Rede e a Comutação de Pacotes"
summary: "A Internet como duas partes (sistemas finais na borda rodando aplicações, e uma malha de roteadores e enlaces no núcleo movendo os seus dados) e a comutação de pacotes, a estratégia do núcleo de picotar mensagens em pequenas unidades e encaminhar cada uma de forma independente em vez de reservar um circuito de ponta a ponta."
---
## Objetivos de Aprendizagem

- Descrever a estrutura da Internet como duas partes distintas: a borda da rede (sistemas finais e redes de acesso) e o núcleo da rede (uma malha interconectada de comutadores de pacotes).
- Definir a comutação de pacotes e explicar como ela difere da comutação de circuitos.
- Calcular o atraso de transmissão store-and-forward para um pacote de um dado tamanho atravessando um enlace de uma dada taxa.
- Explicar por que a comutação de pacotes permite a multiplexação estatística, e por que isso a torna mais eficiente que as reservas dedicadas da comutação de circuitos para o tipo de tráfego em rajadas que aplicações reais geram.
- Identificar o trade-off que a comutação de pacotes aceita em troca dessa eficiência: nenhuma largura de banda garantida, e a possibilidade de atraso de fila ou perda num comutador.

## Contexto e Motivação

Antes que qualquer protocolo, qualquer camada, qualquer algoritmo possa ser discutido, esta disciplina precisa de uma imagem do que a Internet de fato *é*, fisicamente. Ela não é um único fio nem uma única máquina; são milhões de sistemas finais (notebooks, celulares, servidores, sensores) conectados na borda a redes de acesso (um roteador Wi-Fi doméstico, uma torre de celular, uma LAN corporativa), que por sua vez se conectam ao núcleo da rede: uma malha de roteadores interconectados, pertencentes a muitas organizações diferentes (provedores de acesso à Internet, universidades, operadores de backbone), que carrega dados entre quaisquer dois pontos da borda que precisem se comunicar. O livro *Computer Networking: A Top-Down Approach*, de Kurose & Ross, abre exatamente com esta distinção entre borda e núcleo, e ela não é só uma ambientação: todo conceito posterior desta disciplina vive de um lado ou do outro dessa linha. Os conceitos das camadas de aplicação e de transporte descrevem o que acontece na borda, entre dois sistemas finais que se comunicam; a camada de rede e as de baixo descrevem o que acontece dentro do núcleo, conforme os pacotes são movidos salto a salto em direção ao seu destino.

A decisão de projeto definidora do núcleo é como ele move os dados: a comutação de pacotes. Uma mensagem que um usuário quer enviar (um e-mail, uma página web, um frame de vídeo) é quebrada em pedaços menores chamados pacotes, cada um carimbado com um endereço de destino, e cada um é encaminhado de forma independente pela rede, salto a salto, sem reserva prévia de recursos ao longo do caminho. Isso contrasta com a comutação de circuitos, o projeto que as redes telefônicas historicamente usaram, em que uma chamada primeiro reserva uma fatia dedicada de largura de banda ao longo de um caminho inteiro antes que qualquer conversa comece, e mantém essa reserva, usada ou não, durante toda a duração da chamada. Os projetistas da Internet escolheram a comutação de pacotes deliberadamente, e entender por quê (e o que isso custa) é o ponto de entrada para todo o resto desta disciplina.

## Teoria Central

### A borda da rede

A borda da rede consiste nos sistemas finais (também chamados de hosts): os computadores que de fato rodam as aplicações que uma rede existe para suportar (navegadores web, clientes de e-mail, softwares de videoconferência). Os hosts se conectam ao resto da Internet por meio de uma rede de acesso, que pode ser uma conexão de banda larga doméstica, uma Ethernet corporativa ou uma conexão de dados celular. A rede de acesso é a "última milha": o único enlace (ou primeiro salto) que conecta um sistema final à infraestrutura compartilhada do núcleo da rede.

### O núcleo da rede

O núcleo da rede é a malha de comutadores de pacotes (roteadores) e dos enlaces que os conectam, que interconecta toda rede de acesso do planeta, permitindo em princípio que quaisquer dois sistemas finais em qualquer lugar se comuniquem. Um caminho entre dois hosts tipicamente atravessa muitos roteadores, cada um potencialmente de uma organização diferente, conectados por acordos bilaterais ou multilaterais. Não há um dono único nem um controlador central do núcleo como um todo; ele funciona como uma rede de redes administradas de forma independente, e é exatamente por isso que a palavra "Internet" (literalmente, uma rede de redes) o descreve com precisão.

### A comutação de pacotes, definida

Numa rede de comutação de pacotes, a mensagem de um sistema final é dividida em pacotes: pedaços de dados de tamanho fixo ou variável, cada um carregando um cabeçalho com, no mínimo, o endereço de destino do pacote. Cada pacote é transmitido de forma independente pelo núcleo da rede. Em cada roteador do caminho, um pacote é recebido por inteiro, guardado brevemente e então encaminhado adiante em direção ao próximo salto, uma estratégia chamada de transmissão store-and-forward (armazena e encaminha). Nenhum recurso (largura de banda, espaço de buffer) é reservado de antemão para nenhum fluxo específico de pacotes; um roteador atende os pacotes que chegarem, na ordem em que chegarem, compartilhando a capacidade do seu enlace de saída entre todos eles.

### O atraso de transmissão store-and-forward

Como um roteador precisa receber um pacote inteiro antes de poder começar a encaminhar qualquer parte dele adiante, um pacote de `L` bits atravessando um enlace de taxa de transmissão `R` bits/segundo sofre um atraso store-and-forward de `L/R` segundos a cada salto, antes mesmo de o atraso de propagação (o tempo para o próprio sinal percorrer o comprimento físico do enlace) ser considerado. Uma mensagem atravessando `N` enlaces, cada um com a mesma taxa `R`, sofre, portanto, um atraso store-and-forward que se acumula salto a salto, em vez de existir só uma vez na origem: um custo concreto e quantificável do projeto "receba tudo, depois envie adiante", trabalhado com números reais nos Exemplos Resolvidos deste conceito.

### A multiplexação estatística: por que a comutação de pacotes é eficiente

A comutação de circuitos reserva uma fatia fixa da capacidade de um enlace durante toda a duração de uma conexão, tenha ou não essa conexão dados para enviar num dado instante: uma chamada telefônica que fica em silêncio por alguns segundos continua segurando o seu circuito reservado. A comutação de pacotes, em vez disso, deixa todo fluxo disputar a capacidade total de um enlace sempre que de fato tiver um pacote pronto para enviar; um roteador atende pacotes de muitos fluxos diferentes na ordem em que chegam, um arranjo chamado de multiplexação estatística (sem agenda fixa por usuário, ao contrário das fatias de tempo fixas da comutação de circuitos). Para tráfego em rajadas (como quase todo tráfego real de redes de computadores, alternando entre rajadas ativas e intervalos ociosos), a multiplexação estatística permite que muito mais fluxos compartilhem a capacidade total de um dado enlace do que um esquema de reserva por comutação de circuitos permitiria, já que fluxos ociosos não consomem nada.

### O custo: nenhuma garantia, e contenção a cada salto

A eficiência da comutação de pacotes não é de graça. Como nenhuma largura de banda é reservada, pacotes de muitos fluxos diferentes genuinamente competem pelo enlace de saída de um roteador a cada salto; se pacotes demais chegarem de uma vez, a fila de um roteador pode crescer, acrescentando atraso de fila, e se o buffer de um roteador estiver cheio, os pacotes que chegam são simplesmente descartados: perda de pacotes. Diferente de uma chamada por comutação de circuitos, que tem garantida a sua capacidade reservada durante toda a duração depois que a chamada é estabelecida, uma conexão por comutação de pacotes não tem garantia desse tipo em ponto algum do caminho; o desempenho genuinamente depende de quanto outro tráfego calha de estar competindo pelos mesmos enlaces no mesmo momento. Este trade-off (eficiência estatística comprada ao custo de nenhuma garantia por fluxo) é a decisão de projeto mais importante sobre a qual esta disciplina inteira constrói, e ele reaparece explicitamente quando a transferência confiável de dados e o controle de congestionamento são introduzidos mais adiante: o TCP existe especificamente porque a própria camada de rede não promete que um pacote vá chegar, chegar em ordem ou chegar de forma alguma.

## Exemplos Resolvidos

### Exemplo 1: Atraso store-and-forward através de dois enlaces

Um pacote de 2.000 bits precisa atravessar dois enlaces, cada um com taxa de transmissão de 1 Mbps (1.000.000 bits/segundo), por meio de um roteador intermediário. Ignorando por ora o atraso de propagação, o atraso store-and-forward em cada salto é:

```text
L / R = 2.000 bits / 1.000.000 bits/s = 0,002 segundos = 2 ms
```

Como o roteador intermediário precisa receber o pacote *inteiro* antes de encaminhar qualquer parte dele, o atraso store-and-forward total pelos dois saltos não é um único 2 ms: é 2 ms + 2 ms = 4 ms, um atraso de transmissão completo sofrido de forma independente em cada enlace que o pacote atravessa. Esta é uma consequência direta e quantificável do store-and-forward: o atraso se acumula linearmente com o número de saltos, antes mesmo de qualquer atraso de propagação ao longo dos enlaces físicos ser somado.

### Exemplo 2: Comutação de circuitos vs. comutação de pacotes sob tráfego em rajadas

Considere um enlace com capacidade total de 1 Mbps compartilhado entre 10 usuários, cada um ativo só 10% do tempo (em rajadas: enviando dados em rajadas curtas, depois ocioso), mas que, quando ativo, precisa do 1 Mbps completo para se comunicar na taxa desejada.

```text
Comutação de circuitos: reserva 1 Mbps / 10 = 100 kbps por usuário,
  permanentemente, esteja esse usuário ativo ou ocioso. Os 10 usuários
  podem estar conectados simultaneamente, mas cada um fica limitado a
  100 kbps mesmo quando ativo -- muito abaixo do 1 Mbps de que de fato
  precisam ao enviar.

Comutação de pacotes: não faz reserva fixa. Quando um usuário está ativo,
  os seus pacotes podem usar até a capacidade total de 1 Mbps do enlace
  (disputando com quaisquer outros usuários que calhem de estar ativos no
  mesmo instante). Como só ~10% dos usuários estão ativos em média a cada
  momento, as chances de mais que um par de usuários disputarem ao mesmo
  tempo são baixas, então a maioria dos usuários ativos obtém perto do
  1 Mbps completo de que precisa na maior parte do tempo.
```

Esta é a versão concreta e numérica de "a multiplexação estatística permite que mais usuários compartilhem um enlace com eficiência sob tráfego em rajadas": não uma afirmação abstrata, mas um cálculo real de compartilhamento de capacidade.

### Exemplo 3: De onde vem de fato o atraso total de um pacote

Um pacote atravessando um único enlace acumula quatro tipos distintos de atraso, dos quais só um (transmissão/store-and-forward) foi derivado acima:

```text
d_total = d_proc + d_queue + d_trans + d_prop

d_proc  = atraso de processamento: tempo para o roteador examinar o
          cabeçalho do pacote e decidir qual enlace de saída usar.
d_queue = atraso de fila: tempo que o pacote espera num buffer antes de
          poder ser transmitido, se o enlace de saída estiver ocupado.
d_trans = atraso de transmissão: L / R, derivado acima.
d_prop  = atraso de propagação: o tempo físico para o sinal percorrer o
          comprimento do enlace, aproximadamente à velocidade da luz no meio.
```

O atraso de fila é o mais variável dos quatro: ele depende inteiramente de quanto outro tráfego calha de estar competindo pelo mesmo enlace de saída naquele momento, que é precisamente a contenção que a comutação de pacotes aceita em troca da sua eficiência (Atraso, Perda e Vazão, o próximo conceito, desenvolve isso mais a fundo com cenários numéricos reais de intensidade de tráfego).

## Equívocos Comuns e Armadilhas

- **"Comutação de pacotes significa que os pacotes tomam um caminho fixo, único e reservado, só que quebrados em pedaços."** Não: a comutação de pacotes significa especificamente que nenhum caminho nem largura de banda é reservado de antemão. Pacotes diferentes do mesmo fluxo podem até tomar caminhos físicos diferentes pela rede, chegando fora de ordem, embora os conceitos posteriores da camada de transporte desta disciplina mostrem como isso é escondido da aplicação.
- **"Store-and-forward significa que o pacote é guardado permanentemente em cada roteador."** Significa que cada roteador espera receber o pacote *por inteiro* antes de encaminhar qualquer parte dele adiante: uma retenção breve e temporária, exatamente pelo tempo necessário para receber todos os L bits, e não um armazenamento persistente.
- **"A comutação de circuitos é estritamente pior que a comutação de pacotes."** Para tráfego que não é em rajadas (um caso de uso que precisa de uma taxa constante e garantida por uma longa duração), a garantia da comutação de circuitos tem um valor real que o serviço de melhor esforço da comutação de pacotes não fornece. O trade-off é genuíno, e não um erro histórico unilateral.
- **"O núcleo da rede é a infraestrutura de uma organização."** Ele é uma malha de redes de propriedade e administração independentes (provedores, operadores de backbone, universidades) interconectadas por acordos comerciais e técnicos. Não há um dono central único, e é exatamente isso que torna o roteamento entre sistemas autônomos (coberto mais adiante nesta disciplina) um problema genuinamente difícil e em parte econômico.

## Resumo

A estrutura física da Internet se divide na borda da rede (sistemas finais e as suas redes de acesso) e no núcleo da rede (uma malha de comutadores de pacotes e enlaces de propriedade independente). O núcleo move os dados via comutação de pacotes: as mensagens são quebradas em pacotes, cada um encaminhado de forma independente salto a salto, sem reserva prévia de largura de banda, usando a transmissão store-and-forward (um pacote completo precisa ser recebido antes que qualquer parte dele seja encaminhada adiante, acrescentando um atraso L/R a cada salto). Este projeto permite a multiplexação estatística (muitos fluxos em rajadas compartilhando a capacidade de um enlace com muito mais eficiência do que as reservas fixas por fluxo da comutação de circuitos permitiriam), ao custo real de nenhuma garantia de desempenho por fluxo, já que os pacotes genuinamente disputam capacidade a cada salto, o que pode produzir atraso de fila ou, quando o buffer de um roteador está cheio, perda de pacotes pura e simples. Esta fundação de borda/núcleo e comutação de pacotes é a realidade física sobre a qual todo conceito posterior desta disciplina (camadas de protocolo, análise de atraso, confiabilidade do transporte, roteamento) é construído diretamente.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o enquadramento do livro-texto padrão da borda da rede, do núcleo da rede e da comutação de pacotes como a estrutura fundamental da Internet.
- [ACM/IEEE CS2013: Networking and Communication Knowledge Area](https://csed.acm.org/knowledge-areas-networking-and-communication-nc-cs2013-version/): diretrizes curriculares que estabelecem a comutação de pacotes e a estrutura da rede como material fundamental Tier-1 desta área.
