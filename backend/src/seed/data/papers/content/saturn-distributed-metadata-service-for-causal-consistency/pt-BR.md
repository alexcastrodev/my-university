---
title: "Saturn: um serviço distribuído de metadados para consistência causal"
summary: O Saturn é um serviço de metadados que propaga pequenos rótulos de tamanho constante por uma árvore de serializadores, para que armazenamentos com replicação geográfica ganhem consistência causal com pouco custo de vazão, baixa latência de visibilidade remota e replicação parcial genuína.
researchArea: Sistemas distribuídos
keywords: consistência causal, replicação geográfica, replicação parcial, serviço de metadados, falsas dependências, latência de visibilidade
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

A consistência causal importa para armazenamentos com replicação geográfica porque, como o artigo lembra, foi provado que ela é o modelo de consistência mais forte que não compromete a disponibilidade. A dificuldade está nos metadados. Comprimi-los cria falsas dependências, em que uma atualização espera outra que é concorrente a ela, e os dados remotos ficam visíveis tarde. Rastrear a causalidade com precisão evita isso, mas o custo reduz a vazão. O GentleRain, com um único escalar, e o Cure, com um vector clock de uma entrada por datacenter, ilustram os dois lados. A replicação parcial acrescenta atrasos causados por itens que um site nem armazena.

Este artigo do EuroSys 2017 tira os metadados do caminho dos dados. O Saturn é um serviço separado, acoplado a um armazenamento existente. Ele cuida só de pequenos rótulos, enquanto os dados viajam pela transferência em massa da aplicação, e um datacenter aplica uma atualização remota quando tem o conteúdo e o rótulo.

Vale conhecer antes: ordem causal, timestamps no estilo de Lamport, consistência eventual e replicação parcial, em que cada item fica em apenas alguns datacenters.

## Contribuição

- **Rótulos de tamanho constante.** Um rótulo tem um tipo, uma origem, um timestamp escalar e um alvo. A ordem dos timestamps respeita a causalidade, e os clientes guardam só o maior rótulo que observaram.
- **Uma serialização por datacenter.** A ordem causal é parcial, então várias ordens seriais são válidas. Entregar cedo demais o rótulo de uma atualização lenta faz atualizações posteriores e sem relação com ela esperarem, então o Saturn busca entregar cada rótulo mais ou menos quando os dados chegam.
- **Uma árvore de serializadores.** Os serializadores repassam os rótulos na ordem de chegada por canais FIFO, com os datacenters nas folhas, o que preserva a causalidade. Os rótulos evitam ramos sem datacenter interessado, o que dá replicação parcial genuína.
- **Um problema de configuração.** O Saturn posiciona serializadores e acrescenta atrasos artificiais para que os caminhos de metadados acompanhem as latências da transferência em massa, com peso pela importância de cada caminho. O problema é NP-difícil, então uma heurística poda árvores candidatas com um solver de restrições.
- **Um plano alternativo.** Os rótulos também viajam com o conteúdo, então os datacenters podem usar a ordem de timestamps durante uma interrupção.

## Metodologia

O protótipo, em Erlang/OTP, é acoplado a um armazenamento eventualmente consistente construído pelos autores. Esse armazenamento é a linha de base, e a visibilidade ótima significa a latência dele. Os experimentos rodam em instâncias EC2 m4.large em sete regiões, com um datacenter por região. GentleRain e Cure rodam sua estabilização a cada 5 ms. COPS e Eiger ficam de fora porque os autores concluem que a verificação explícita de dependências não é prática sob replicação geográfica parcial.

Varreduras sintéticas mudam um parâmetro por vez em torno de valores de 2 bytes, razão de leitura para escrita de 9:1 e nenhuma leitura remota. O benchmark baseado no Facebook combina um conjunto público de dados de Nova Orleans (61.096 nós, 905.565 arestas), uma mistura de operações tirada de um estudo publicado e um particionamento guiado por localidade.

## Resultados

Estes são os resultados informados pelos autores. Cada experimento tem seus próprios números.

- **Vazão sintética, em média.** 2,2% de sobrecarga contra a consistência eventual, 4,8% acima do GentleRain e 24,7% acima do Cure. Com 40% de leituras remotas, 15,7% e 60,5% acima deles.
- **Visibilidade sintética.** A latência somada ao ótimo é em média 7,3 ms no Saturn, 21,3 ms no Cure e 97,9 ms no GentleRain. No pior caminho do Saturn, da Irlanda a Sydney, ele soma 20,4 ms no percentil 90, e o Cure fica 3,6 ms abaixo.
- **Benchmark do Facebook.** 1,8% de sobrecarga, com 10,9% mais operações por segundo que o GentleRain e 41,9% mais que o Cure. A visibilidade somada é em média 16,1 ms, contra 79,2 ms e 23,7 ms. No pior caminho, da Irlanda a Tóquio, o Saturn soma 47,2 ms no percentil 90, 0,9 ms acima do GentleRain e 9,9 ms acima do Cure.
- **Configuração.** Uma árvore com vários serializadores se desvia 8,2 ms do ótimo em média, enquanto a ordem de timestamps sozinha tende ao maior tempo de viagem, 161 ms. Com 25 ms injetados em um enlace de 10 ms, a configuração normalmente ótima soma 14 ms em média.

## Análise crítica

A ideia central se sustenta: a ordem pode ser levada pelo caminho dos metadados, e não pelo tamanho deles. Algumas afirmações em volta dela vão além da evidência.

O próprio artigo admite estes limites:

- **Uma única árvore não serve a todos os pares.** O artigo reconhece que alcançar a latência ótima em todos os pares é improvável e, na maioria dos casos, impossível. Nos piores caminhos, Cure e GentleRain podem se sair melhor, então o "eliminates the tradeoff" do resumo é mais forte que os resultados, que mostram um compromisso bem menor, deslocado para a configuração.
- **A configuração é offline.** Mudanças substanciais na carga pedem uma nova árvore.
- **A correção é só esboçada.** O argumento da árvore é uma nota de rodapé que omite a prova por falta de espaço.
- **O datacenter carrega suposições.** Cada um precisa ser linearizável e exportar um único fluxo serial de atualizações.

O restante é uma leitura da avaliação:

- **Os números de destaque parecem ser misturas.** Os 2%, 11,7 ms e 76,9 ms da introdução batem com as médias dos resultados sintéticos e do Facebook, embora o artigo não diga isso. Os 38,3% sobre o Cure não batem: 24,7 e 41,9 dão média 33,3.
- **Valores pequenos favorecem o projeto.** O padrão é de 2 bytes, e o artigo relata que em 2048 bytes todos os sistemas tratam quase a mesma carga.
- **A comparação sob replicação parcial é desigual.** A Tabela 2 do artigo marca GentleRain e Cure como sem replicação parcial, e só o Saturn tem rótulos de migração.
- **Os caminhos de falha não são medidos.** Nenhum experimento cronometra uma falha de serializador ou o plano alternativo por timestamps, e os resultados de configuração sugerem que esse plano abre mão da maior parte do ganho de atualidade.
- **A escala é argumentada, não medida.** A avaliação para em sete datacenters e não informa quantos servidores há por datacenter.

## Pesquisas futuras

- Avaliar falhas de serializadores, o plano alternativo por timestamps e a recuperação sob carga.
- Como a estabilização por timestamps progride sob replicação parcial quando dois datacenters não compartilham dados.
- Árvores que se adaptam em operação à latência medida da transferência em massa, e o custo de conteúdos que atrasam em relação aos rótulos.
- O custo de exportar um único fluxo serial em datacenters grandes.
- O próprio artigo aponta para combinar o Saturn com o Occult e para uma versão distribuída do Kronos.
