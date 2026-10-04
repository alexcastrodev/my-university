---
version: 1.0
updatedAt: 2026-09-06
title: "Protocolos de Acesso Múltiplo e Ethernet"
summary: "Quando muitos hosts compartilham um único meio físico, algo precisa decidir quem transmite quando. O CSMA/CD (detecção de portadora, detecção de colisão, recuo aleatório exponencial) é a resposta da Ethernet clássica, e a capacidade de um switch de isolar cada enlace no seu próprio domínio de colisão é a razão real de a Ethernet comutada moderna mal precisar dele hoje."
---
## Objetivos de Aprendizagem

- Enunciar o problema de acesso múltiplo: o que acontece quando vários nós compartilham um único meio de transmissão físico ao mesmo tempo.
- Descrever o CSMA/CD (detecção de portadora, acesso múltiplo, detecção de colisão) passo a passo, incluindo o recuo aleatório exponencial.
- Explicar por que o recuo exponencial é aleatorizado, e por que a parte "exponencial" importa conforme a disputa aumenta.
- Distinguir um hub (um domínio de colisão compartilhado) de um switch (que isola cada enlace no seu próprio domínio de colisão), e explicar por que isso torna o CSMA/CD praticamente desnecessário na Ethernet comutada moderna.
- Contrastar endereços MAC (camada de enlace) com endereços IP (camada de rede), e enunciar por que os dois são necessários, em vez de qualquer um sozinho.

## Contexto e Motivação

O conceito anterior cobriu o enquadramento e a detecção de erros para um único enlace entre dois nós. Este conceito cobre um problema genuinamente diferente: o que acontece quando mais de dois nós compartilham exatamente o mesmo meio físico (o mesmo fio, ou a mesma faixa do espectro de rádio) e qualquer um deles pode querer transmitir a qualquer momento. A Ethernet clássica, historicamente, foi construída exatamente sobre esse modelo de meio compartilhado, e o CSMA/CD é a sua solução real e implantada para o problema de disputa resultante. Mesmo que a Ethernet comutada moderna tenha tornado o mecanismo ativo de tratamento de colisões do CSMA/CD praticamente desnecessário na prática (um fato genuinamente importante e concreto que este conceito explica, em vez de deixar de lado), entender o problema do meio compartilhado e a sua solução clássica continua fundamental, e prepara diretamente o conceito seguinte, sobre redes sem fio, onde um problema muito parecido reaparece numa forma que não pode ser resolvida do mesmo jeito.

## Teoria Central

### O problema de acesso múltiplo

Quando vários nós compartilham um único meio de transmissão físico, e mais de um transmite ao mesmo tempo, os seus sinais interferem (uma colisão), corrompendo as duas transmissões de modo que nenhuma é recebida corretamente. Um protocolo de acesso múltiplo é o conjunto de regras que os nós que compartilham um meio seguem para coordenar quem transmite quando, na tentativa de evitar essas colisões ou, pelo menos, se recuperar delas graciosamente.

### CSMA: detecção de portadora, acesso múltiplo

O Carrier Sense Multiple Access (CSMA) é a primeira metade da abordagem da Ethernet clássica: antes de transmitir, um nó "escuta" o meio compartilhado (detecta se um sinal de portadora, a transmissão em andamento de outra pessoa, está presente no momento). Se o meio parece ocioso, o nó transmite; se o meio parece ocupado, o nó espera. Só isso já reduz substancialmente as colisões, mas não as elimina: por causa do atraso de propagação real, dois nós em pontos diferentes do meio podem ambos detectar o meio como ocioso e começar a transmitir quase no mesmo instante, antes que o sinal de qualquer um deles tenha tido tempo de alcançar fisicamente o outro e ser detectado por ele. Uma colisão genuína ainda pode ocorrer mesmo com a detecção de portadora em funcionamento.

### CD: detecção de colisão

A Collision Detection (CD), a segunda metade, faz com que um nó transmissor continue escutando o meio enquanto transmite, especificamente para detectar se ocorreu uma colisão (normalmente ao notar um nível de sinal inconsistente com só a sua própria transmissão). Se uma colisão é detectada, o nó transmissor para de transmitir imediatamente (em vez de desperdiçar a capacidade do meio terminando uma transmissão que já foi corrompida) e entra num procedimento de recuo e nova tentativa.

### Recuo aleatório exponencial

Depois de detectar uma colisão, um nó não tenta de novo simplesmente de imediato: fazer isso muito provavelmente produziria outra colisão imediata com o(s) mesmo(s) nó(s) com que acabou de colidir, especialmente se todos seguirem uma regra de nova tentativa idêntica e determinística. Em vez disso, cada nó espera um tempo aleatório, escolhido de uma faixa que cresce exponencialmente a cada colisão sucessiva envolvendo o mesmo quadro: a primeira colisão escolhe uma espera aleatória de uma faixa pequena, uma segunda colisão consecutiva (para o mesmo quadro) escolhe de uma faixa duas vezes maior, e assim por diante. A aleatorização espalha as novas tentativas de modo que dois nós que acabaram de colidir têm muito pouca chance de escolher exatamente o mesmo tempo de espera de novo; o crescimento exponencial da faixa responde especificamente a uma disputa genuinamente alta (muitas colisões consecutivas sugerindo que o meio está fortemente carregado neste momento) espalhando as novas tentativas por uma janela cada vez mais larga, reduzindo as chances de mais uma colisão conforme a disputa aumenta.

### Hubs vs. switches: domínios de colisão

Um hub é um dispositivo simples da camada física que repete um sinal recebido para todas as outras portas: todo nó conectado a um hub compartilha um único domínio de colisão, o que significa que o mecanismo de tratamento de colisões do CSMA/CD é genuinamente necessário, já que quaisquer dois nós conectados ao mesmo hub realmente podem colidir. Um switch, em contraste, é um dispositivo da camada de enlace que examina o endereço MAC de destino de cada quadro e o encaminha só pela porta específica conectada ao destinatário pretendido. Cada enlace conectado a um switch é efetivamente o seu próprio domínio de colisão, isolado, e se as portas de um switch operam em modo full-duplex (caminhos de envio e recepção separados e simultâneos, comum na Ethernet moderna), as colisões se tornam estruturalmente impossíveis naquele enlace por completo. É exatamente por isso que o CSMA/CD, embora historicamente essencial para a Ethernet clássica baseada em hubs, é praticamente vestigial nas redes Ethernet modernas, totalmente comutadas e full-duplex: o meio compartilhado propenso a colisões para o qual o protocolo foi projetado foi, na maioria das implantações modernas, simplesmente eliminado por engenharia pelos switches.

### Endereços MAC vs. endereços IP

Toda interface de rede tem um endereço da camada de enlace (um endereço MAC, Media Access Control, normalmente um identificador de 48 bits globalmente único gravado no hardware), usado para identificar uma interface específica para a entrega da camada de enlace de exatamente um salto (os campos de origem e destino de um quadro Ethernet são endereços MAC, e não endereços IP). Este é um tipo de endereço genuinamente diferente do endereço IP da camada de rede já coberto, que identifica um host para fins de roteamento pelo núcleo inteiro da rede, de múltiplos saltos. Os dois são necessários ao mesmo tempo, em camadas diferentes, exatamente pela mesma razão pela qual as próprias camadas existem: os endereços IP suportam um roteamento hierárquico e agregável por uma rede de tamanho e estrutura arbitrários, enquanto os endereços MAC fornecem uma identidade plana, no nível do hardware, necessária para a entrega local de um único enlace, um trabalho que o endereçamento IP não é estruturado para fazer diretamente.

## Exemplos Resolvidos

### Exemplo 1: Uma colisão detectada no meio da transmissão

```text
1. O nó A detecta que o meio está ocioso e começa a transmitir.
2. O nó B, quase no mesmo instante, também detecta o meio como ocioso
   (o sinal de A ainda não alcançou B fisicamente por causa do atraso
   de propagação) e também começa a transmitir.
3. Os dois sinais colidem no meio compartilhado.
4. A e B, ainda escutando enquanto transmitem, detectam a colisão e
   param de transmitir imediatamente.
5. A e B calculam, de forma independente, um tempo de recuo aleatório
   a partir de uma faixa inicial pequena (digamos, de 0 a 1 unidade de
   slot de tempo) e esperam esse tempo antes de tentar retransmitir.
```

Se A e B acabarem escolhendo valores de recuo aleatórios diferentes (o resultado de longe mais provável), um deles retransmite primeiro, com sucesso, antes mesmo de o temporizador de recuo do outro expirar, resolvendo a disputa sem uma colisão repetida.

### Exemplo 2: O crescimento exponencial da faixa de recuo depois de colisões repetidas

```text
1ª colisão (para um dado quadro):  recuo escolhido da faixa [0, 1]
2ª colisão consecutiva:             recuo escolhido da faixa [0, 3]
3ª colisão consecutiva:             recuo escolhido da faixa [0, 7]
4ª colisão consecutiva:             recuo escolhido da faixa [0, 15]
```

Cada colisão sucessiva (para o mesmo quadro, ainda não enviado com sucesso) dobra a faixa da qual o recuo aleatório é sorteado: uma resposta direta à evidência aparente de disputa alta (colisões repetidas), espalhando as novas tentativas por uma janela cada vez mais larga especificamente para reduzir as chances de mais uma colisão na próxima vez.

### Exemplo 3: Hub vs. switch: onde uma colisão pode e não pode ocorrer

```text
Topologia com hub: os nós A, B, C, D todos conectados a um único hub.
  A transmitindo e B transmitindo ao mesmo tempo: COLISÃO (os quatro
  nós compartilham um único domínio de colisão; o hub repete todo
  sinal para todas as portas).

Topologia com switch: os nós A, B, C, D cada um conectado à sua própria
  porta dedicada num switch, cada porta operando em full-duplex.
  A transmitindo para o switch e B transmitindo para o switch ao mesmo
  tempo: SEM COLISÃO (cada enlace, A-para-switch e B-para-switch, é o
  seu próprio domínio de colisão, separado e isolado; o switch
  simplesmente encaminha cada quadro pela porta de destino correta, de
  forma independente).
```

É exatamente por isso que as implantações modernas de Ethernet, construídas quase inteiramente sobre switches em vez de hubs, raramente ou nunca experimentam uma colisão real na prática. O mecanismo do CSMA/CD continua fazendo parte do padrão Ethernet por razões históricas e de compatibilidade, mas o cenário de meio compartilhado que ele existe para tratar foi, em sua maior parte, eliminado por engenharia pela comutação.

## Equívocos Comuns e Armadilhas

- **"O CSMA/CD evita todas as colisões."** A detecção de portadora sozinha não consegue evitar colisões causadas pelo atraso de propagação (dois nós detectando um meio ocioso antes que a transmissão de qualquer um deles tenha alcançado fisicamente o outro). A contribuição real do CSMA/CD é detectar uma colisão rapidamente depois que ela acontece e se recuperar dela graciosamente via recuo aleatorizado, e não evitar que toda colisão possível ocorra, para começo de conversa.
- **"A Ethernet moderna ainda depende fortemente do CSMA/CD."** A Ethernet moderna, totalmente comutada e full-duplex, praticamente elimina o cenário de meio compartilhado que o CSMA/CD existe para tratar: as colisões são estruturalmente impossíveis num enlace comutado full-duplex, tornando o mecanismo ativo do CSMA/CD vestigial na maioria das implantações contemporâneas, mesmo que ele continue fazendo parte do padrão Ethernet histórico.
- **"O tempo de recuo deveria simplesmente dobrar a cada colisão, e não ser aleatorizado."** A aleatorização, e não meramente a faixa que dobra, é o que de fato resolve a disputa entre dois nós específicos que colidiram. Se os dois nós usassem uma regra fixa e determinística sem nenhuma aleatoriedade, eles poderiam plausivelmente tentar de novo exatamente no mesmo momento repetidamente; escolher aleatoriamente um tempo de espera dentro de uma faixa (crescente) é o que torna improvável que dois nós que colidiram escolham o mesmo momento de nova tentativa de novo.
- **"Endereços MAC e endereços IP servem ao mesmo propósito, só que em camadas diferentes, então qualquer um sozinho bastaria."** Eles servem a propósitos genuinamente diferentes e complementares: os endereços MAC fornecem uma identidade plana, no nível do hardware, de salto único; os endereços IP fornecem uma identidade de roteamento hierárquica, agregável e de múltiplos saltos. Uma rede precisa dos dois ao mesmo tempo, e é exatamente por isso que o ARP (o próximo conceito) existe para traduzir entre os dois.

## Resumo

Quando vários nós compartilham um único meio de transmissão físico, as suas transmissões podem colidir, corrompendo as duas. O protocolo CSMA/CD da Ethernet clássica trata disso fazendo com que os nós escutem o meio antes de transmitir (detecção de portadora), detectem colisões enquanto transmitem (detecção de colisão) e recuem por um tempo de espera aleatorizado e exponencialmente crescente depois de cada colisão antes de tentar de novo, especificamente para reduzir as chances de colisões repetidas conforme a disputa aumenta. Os hubs criam um único domínio de colisão compartilhado entre todos os nós conectados, tornando o CSMA/CD genuinamente necessário; os switches isolam cada enlace no seu próprio domínio de colisão, tornando as colisões estruturalmente raras ou impossíveis na Ethernet moderna, totalmente comutada e full-duplex. É exatamente por isso que o CSMA/CD, embora fundamental historicamente, é praticamente vestigial na maioria das implantações contemporâneas. Os endereços MAC, distintos e complementares aos endereços IP já cobertos, fornecem a identidade plana, no nível do hardware, de que a entrega da camada de enlace precisa para exatamente um salto. O próximo conceito, o ARP, cobre precisamente como um nó traduz entre esses dois tipos diferentes de endereço quando precisa entregar um quadro a um próximo salto específico.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão dos protocolos de acesso múltiplo, do CSMA/CD e da Ethernet.
- [Stanford CS144: Lecture Schedule ("Physical and Link layers")](https://www.scs.stanford.edu/10au-cs144/sched/): uma aula de um curso real que cobre a Ethernet e o acesso múltiplo junto com a camada física.
