---
title: "Chord: um serviço escalável de busca peer-to-peer para aplicações na Internet"
summary: Stoica e colegas apresentam o Chord, um protocolo que mapeia qualquer chave para um nó de uma rede peer-to-peer com hashing consistente e uma tabela de O(log N) "fingers" por nó, de modo que cada busca custa O(log N) mensagens enquanto nós entram e saem o tempo todo.
researchArea: Sistemas distribuídos
keywords: chord, tabela hash distribuída, hashing consistente, peer-to-peer, tabela de fingers, estabilização
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A fundamental problem that confronts peer-to-peer applications is to efficiently locate the node that stores a particular data item. This paper presents Chord, a distributed lookup protocol that addresses this problem. Chord provides support for just one operation: given a key, it maps the key onto a node. Data location can be easily implemented on top of Chord by associating a key with each data item, and storing the key/data item pair at the node to which the key maps. Chord adapts efficiently as nodes join and leave the system, and can answer queries even if the system is continuously changing. Results from theoretical analysis, simulations, and experiments show that Chord is scalable, with communication cost and the state maintained by each node scaling logarithmically with the number of Chord nodes.

## Visão geral

Em 2001, cada um dos sistemas peer-to-peer com que o artigo se compara tinha um ponto fraco na hora de achar dados. O Napster dependia de um servidor central, o Gnutella espalhava as consultas por broadcast e não escalava, e o Freenet procurava cópias em cache, o que dava algum anonimato, mas nenhuma garantia de encontrar um documento existente nem um limite de custo. O Chord, publicado no ACM SIGCOMM 2001 por pesquisadores do MIT e da UC Berkeley, defende que a operação central por baixo de todos eles é uma só: dada uma chave, achar o nó responsável por ela. Em seguida constrói um protocolo que faz só isso, com custo provado.

O Chord deixa o resto para a aplicação: replicação, cache, autenticação e nomes ficam em uma camada superior, e a biblioteca apenas avisa a aplicação quando muda o conjunto de chaves de que um nó é responsável. Anéis de hash também aparecem no [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), que cita o Chord e segue outro caminho: seus autores evitam o roteamento em vários saltos por causa da latência (veja a Análise crítica).

Vale conhecer antes: o que faz uma função de hash, por que um simples `hash(chave) mod N` obriga a mover quase todas as chaves quando N muda, e o básico de logaritmo (dobrar os nós acrescenta um passo).

## Contribuição

- **Um serviço de uma única operação.** `lookup(chave)` devolve o endereço IP do nó responsável pela chave. O espaço de chaves é plano, então cada aplicação escolhe seus próprios nomes.
- **Hashing consistente em um círculo de identificadores.** Nós e chaves recebem identificadores de m bits de uma função de hash base como o SHA-1 (o identificador de um nó é o hash do seu IP). Uma chave pertence ao seu sucessor, o primeiro nó cujo identificador é igual ou posterior a ela no círculo módulo 2^m.
- **Tabelas de fingers.** O nó n guarda m entradas, e a entrada i aponta para o primeiro nó que sucede n em pelo menos 2^(i-1). Um nó conhece muitos nós próximos e poucos distantes, e a busca segue para o finger que mais se aproxima da chave sem passar dela, o que reduz à metade a distância restante a cada salto.
- **Entrada, saída e estabilização.** A entrada básica mantém os fingers exatos quando um nó chega. Para entradas concorrentes e falhas, o `stabilize` periódico mantém corretos os ponteiros de sucessor, o que sozinho garante a correção, e o `fix_fingers` conserta a tabela para dar velocidade. Uma lista de r sucessores trata as falhas.
- **Separar correção de desempenho.** Só os ponteiros de sucessor precisam estar certos para que as buscas sejam corretas, ainda que possivelmente lentas.

## Metodologia

O artigo combina análise, simulação e um protótipo. A Seção 4 dá os algoritmos em pseudocódigo e prova limites. As provas de vários teoremas (3, 4, 5, 7 e 8) estão no relatório técnico que acompanha o artigo, não nele. Um exemplo trabalhado usa m = 3 e os nós 0, 1 e 3: a chave 1 fica no nó 1, a chave 2 no nó 3 e a chave 6 no nó 0, e um nó de identificador 7 que entrasse tomaria a chave 6 do nó 0.

O simulador executa o algoritmo de busca do artigo e uma versão um pouco mais antiga das rotinas de estabilização, no estilo iterativo, em que o nó que consulta contata cada salto por conta própria. Os experimentos cobrem balanceamento de carga, comprimento de caminho, falhas simultâneas e buscas durante a estabilização. O protótipo roda em UNIX, usa chaves SHA-1 de 160 bits e TCP, e foi medido por Frank Dabek em dez sites do testbed RON, com mais de dez nós obtidos rodando várias cópias independentes por site. Cada site físico fez 16 buscas para cada número de nós.

## Resultados

Primeiro os teoremas, depois as medições. Os limites valem com alta probabilidade ou sob hipóteses padrão de dificuldade sobre o SHA-1.

- **Custo.** Cada nó guarda informação sobre O(log N) outros, e uma busca contata O(log N) nós (Teorema 2). Uma entrada ou saída custa O(log² N) mensagens (Teorema 3), e só O(K/N) das K chaves mudam de dono.
- **Entradas concorrentes.** Depois da última entrada todos os ponteiros de sucessor estão corretos (Teorema 5), e um nó que conseguiu resolver uma consulta sempre conseguirá depois (Teorema 4). Com N nós numa rede estável, até N nós a mais entrando sem fingers ainda deixam as buscas em O(log N) (Teorema 6).
- **Falhas.** Com uma lista de sucessores de tamanho logarítmico, mesmo que cada nó falhe com probabilidade 1/2, a busca ainda acha o sucessor vivo mais próximo em tempo esperado O(log N) (Teoremas 7 e 8).
- **Balanceamento de carga.** Com 10.000 nós e 5 x 10^5 chaves, o nó mais carregado guardou 457 chaves, 9,1 vezes a média, e o percentil 99 ficou em 4,6 vezes a média. Alguns nós ficaram sem nenhuma chave. Com 10^6 chaves, passar de 1 para 20 nós virtuais por nó real reduziu o percentil 99 de 4,8 para 1,6 vez a média.
- **Comprimento do caminho.** Simulando N = 2^k nós, com k de 3 a 14, o caminho médio foi de cerca de (1/2) log2 N, porque em média metade dos bits da distância são uns e só eles exigem um finger.
- **Falhas simultâneas.** Com 10.000 nós e 10^6 chaves, a taxa de falha das buscas foi quase exatamente a fração p de nós que falharam, que é a parcela das chaves que estava nos nós perdidos.
- **Churn.** Com 500 nós e estabilização a cada 30 segundos, as falhas nas buscas cresceram com a taxa de entradas e saídas. Os autores estimam cerca de 3% para três falhas entre estabilizações e notam que o simulador não refaz as consultas.
- **Protótipo.** A latência mediana ficou entre 180 e 285 ms. Com 180 nós uma busca precisa de cinco idas e voltas e, com cerca de 60 ms entre os sites, os 300 ms esperados ficam perto da mediana medida de 285.

## Análise crítica

O artigo é incomumente claro sobre o que não resolve, e vários dos limites abaixo são declarados pelos próprios autores.

- **Partições.** A estabilização não conserta um anel que se dividiu em vários ciclos nem um que dá mais de uma volta no espaço. Os autores dizem que esses casos não surgem de entradas comuns, mas não está claro se partições e recuperações poderiam produzi-los.
- **Segurança.** O Chord não oferece anonimato. Um atacante poderia inserir um nó com identificador logo após o de uma chave e devolver erros para ela. O artigo sugere derivar os identificadores do hash SHA-1 do IP e conferi-los, e lista um participante malicioso do anel como ameaça.
- **Distância de rede.** O Chord ignora a topologia: um salto pode cruzar um oceano. Os autores admitem que ele explora localidade pior que o protocolo de Plaxton e o Globe, e propõem como trabalho futuro escolher fingers pelo atraso medido.
- **Escala da avaliação.** A simulação de churn tem 500 nós, e o protótipo é "preliminar", com menos de 200 nós, na maioria cópias que dividem dez sites.

Literatura posterior, não afirmada pelo artigo:

- **Dynamo.** O artigo do [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) cita o Chord e diz que o roteamento em vários saltos "aumenta a variabilidade nos tempos de resposta" nos percentis altos. O Dynamo dá a cada nó informação de roteamento suficiente para alcançar qualquer outro em um salto, o que chama de DHT de zero saltos.
- **Correção.** Pamela Zave modelou o protocolo de manutenção do anel em Alloy e relatou no ACM SIGCOMM CCR (2012) que, sob as hipóteses de falha dos artigos do Chord, nenhuma versão publicada do Chord é correta, e que uma versão corrigida talvez exista.
- **DHTs em produção.** A DHT sem tracker do BitTorrent (BEP 5) é descrita como baseada no Kademlia, com métrica de distância XOR, e não no Chord.

## Pesquisas futuras

- Curar anéis particionados, por amostragem do anel ou guardando memória de longo prazo de vizinhos antigos (ideias dos autores).
- Escolher fingers ou sucessores por proximidade na rede para reduzir a latência da busca, e espaçamentos alternativos de fingers, como distâncias em potências de 1 + 1/d.
- Resistir a participantes maliciosos ou com defeito que apresentam uma visão errada do anel.
- A versão de periódico, *Chord: a scalable peer-to-peer lookup protocol for internet applications* (IEEE/ACM Transactions on Networking, 2003), e sua relação com este artigo.
- Especificação formal e provas verificadas por máquina da manutenção do anel, como o trabalho de Zave.
