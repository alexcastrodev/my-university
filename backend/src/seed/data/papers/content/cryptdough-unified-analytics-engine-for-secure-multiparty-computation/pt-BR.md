---
title: "CryptDough: um motor de análise unificado para computação multipartidária segura"
summary: O CryptDough é um motor em camadas para computação multipartidária segura que executa cargas relacionais, de séries temporais e de inferência de ML, e pipelines que as misturam, sob quatro protocolos de MPC que cobrem adversários semi-honestos e maliciosos, usando tipos de dados só vetoriais e vetores virtuais para que os autores de bibliotecas escrevam código oblivious de thread única enquanto o runtime agrupa mensagens e paraleliza.
researchArea: Segurança e privacidade
keywords: computação multipartidária segura, compartilhamento de segredos, algoritmos oblivious, análise segura, vetores virtuais, modelos de ameaça, inferência de ml
version: 1.0
updatedAt: 2026-11-18
---

## Visão geral

A computação multipartidária segura (MPC) permite que várias partes calculem uma função sobre seus dados privados e aprendam apenas o resultado, dividindo cada valor em compartilhamentos secretos (secret shares) mantidos por partes de computação independentes. As implantações reais são poucas e em geral simples (estatísticas agregadas, ML básico), e os autores, da Boston University, apontam três razões que puxam em direções diferentes. Os modelos de ameaça variam: alguns usos aceitam partes semi-honestas (honestas mas curiosas), outros exigem proteção contra partes maliciosas, com maioria honesta ou desonesta. Os pipelines de análise misturam cargas, como uma consulta relacional que alimenta um modelo de ML, ou janelas de séries temporais seguidas de agregações. E os analistas querem programas de alto nível, sem conhecimento de criptografia.

Os sistemas existentes visam cada um um protocolo ou uma carga (inferência de ML, consultas relacionais ou séries temporais), então um pipeline misto significa costurar sistemas, com codificações de dados, modelos de ameaça e runtimes incompatíveis, ou escrever tudo num compilador geral de MPC. Este artigo do SOSP 2026 apresenta o CryptDough como o primeiro sistema de análise unificado para MPC, com suporte embutido a cargas mistas sob vários modelos de ameaça e um projeto voltado para modularidade e extensibilidade.

Termos para não confundir: compartilhamento secreto é um pedaço aleatório de um valor (os aritméticos somam o segredo módulo `2^l`, os booleanos fazem XOR até ele), algoritmo oblivious é aquele cujo fluxo de controle nunca depende de dados secretos, triple de Beaver é aleatoriedade correlacionada pré-computada (a, b, c com c = a x b) usada para multiplicar compartilhamentos, e segurança maliciosa com abort significa que a computação para assim que a trapaça é detectada.

Vale conhecer antes: compartilhamento secreto aditivo e por que a multiplicação exige comunicação e a soma não, e como as redes de ordenação dão sequências de comparação independentes dos dados. As bibliotecas relacional e de séries temporais do artigo se apoiam em sistemas anteriores que ele nomeia, ORQ e TVA, então lê-los ajuda.

## Contribuição

- **Uma hierarquia de quatro camadas.** Funcionalidades de MPC de baixo nível (`+`, `x`, XOR e AND seguros), depois primitivas oblivious (comparações, multiplexadores, somadores, compare-and-swap, ReLU, convolução, multiplicação de matrizes), depois operadores de alto nível, depois composição de operadores. Toda camada exceto a de baixo é agnóstica ao protocolo e usa a de baixo como caixa-preta, então o código não tem desvios sobre dados secretos e executa as mesmas operações para todas as entradas de um dado tamanho.
- **Três tipos de usuário, uma pilha.** O analista de dados compõe fluxos com uma API declarativa no estilo do Spark (`SecureTable`, `SecureTS`, `SecureMatrix`). O desenvolvedor de bibliotecas escreve novos operadores seguros a partir de primitivas vetorizadas. O criptógrafo aplicado acrescenta um protocolo definindo um tipo de compartilhamento, o número de partes e um pequeno conjunto de funcionalidades, com um comunicador e um gerador de aleatoriedade fornecidos. O trabalho de cada tipo de usuário deve beneficiar os outros dois sem esforço de integração, e especialistas podem sobrescrever os padrões com versões específicas de protocolo, por exemplo um produto escalar que faz a parte interativa da multiplicação uma vez em vez de por elemento no compartilhamento replicado.
- **Modelo de programação só vetorial.** Os tipos de dados são contêineres (`Vector`, `EVector` para vários compartilhamentos por segredo ou MACs, `SharedVector`) que só aceitam operações sobre o contêiner inteiro. As camadas de operadores e de análise proíbem laços sobre elementos e condicionais sobre dados privados, e as escolhas que dependem dos dados usam um multiplexador oblivious que avalia os dois ramos. Isso deixa o runtime agrupar mensagens entre operações elemento a elemento, então um compare-and-swap leva `O(log |T|)` rodadas, com `|T|` o tamanho do compartilhamento em bits, em vez de `O(n log |T|)` num laço por elemento.
- **Vetores virtuais.** Algoritmos oblivious como ordenação e redes de prefixo tocam elementos não contíguos. Um vetor virtual `W` é uma visão restrita de um vetor base `V` com `W[i] = V[f(i)]`, construída de forma declarativa com `offset()`, `step()` e `limit()`. O runtime particiona e distribui vetores virtuais como se fossem contíguos, tratando a tradução de índices e a memória, então os desenvolvedores de bibliotecas escrevem código de thread única e ainda obtêm paralelismo sem cópias extras dos dados.
- **Modelo de execução.** Cada parte é um processo do SO com uma thread coordenadora e threads de trabalho. Os trabalhadores correspondentes entre as partes formam miniclusters independentes, com seus próprios objetos de protocolo, comunicador e aleatoriedade, e threads de comunicação dedicadas trocam mensagens por buffers lock-free. Os miniclusters só se sincronizam nas fronteiras das primitivas.
- **Protocolos e bibliotecas.** Quatro protocolos cobrem os modelos de ameaça: ABY (semi-honesto, maioria desonesta), ABY3 (semi-honesto, maioria honesta), Fantastic Four (malicioso, maioria honesta) e SPDZ2k (malicioso, maioria desonesta). A biblioteca relacional tem a funcionalidade do ORQ mais aritmética de ponto fixo, redes de prefixo e bitonic sort, a de séries temporais tem janelas tumbling e de sessão e os operadores independentes do tempo do TVA, e a de ML tem convolução, ReLU, pooling e camadas totalmente conectadas para redes como VGG-16 e AlexNet. O código é C++ (libsodium, libOTE, Blaze) com um comunicador MPI ou por sockets.

## Metodologia

Os experimentos usam quatro ambientes: um cluster bare-metal de quatro máquinas AMD EPYC 9655P de 96 núcleos numa LAN (até 25 Gbps, RTT de 0,17 a 0,25 ms) e numa WAN limitada (6 Gbps, RTT de 20 ms), e duas instâncias AWS g6.8xlarge com GPUs NVIDIA L4 nos mesmos dois cenários. Os compartilhamentos têm 64 bits, salvo indicação, os números são a média de três execuções, e para os protocolos de maioria desonesta só se reporta o tempo online.

O primeiro experimento é um pipeline misto de ponta a ponta nos quatro protocolos: classificação com VGG16 de 64 imagens de raio X, um join com 1 mil registros de pacientes asmáticos, uma janela por limiar com filtro e agregação sobre 16 mil medições de saturação de oxigênio e uma subconsulta relacional com join, três filtros e group-by. Depois o CryptDough é comparado, sempre sob o mesmo modelo de ameaça, com o ORQ (nove consultas reais com fator de escala 1, cerca de 5 milhões de linhas por tabela), o TVA (suas três aplicações em séries temporais de 2^22 linhas, com compartilhamentos de 32 bits e bitonic sort, 16 threads), o Pigeon (AlexNet e VGG16 em CIFAR-10 e ImageNet, 192 imagens, 24 processos), o Piranha (só GPU, rodado na AWS contra o CryptDough de thread única) e o MP-SPDZ (uma AlexNet própria sob SPDZ2k, 16 threads, 192 imagens). Por fim mede-se a escalabilidade das primitivas (comparação, somadores ripple-carry e de prefixo paralelo, convolução) e do bitonic sort e do quicksort de 1 a 32 threads no ABY3. Nenhuma linha de base com sistemas especializados costurados é construída, apenas uma estimativa de custo.

## Resultados

Estes são os resultados reportados pelos autores.

- **Pipeline misto.** Com segurança semi-honesta o pipeline inteiro leva cerca de 1 minuto na LAN e menos de 5 minutos na WAN. Com segurança maliciosa leva 18 minutos com maioria honesta e pouco mais de 1 hora com maioria desonesta na WAN. Os autores dizem que é a primeira demonstração de um pipeline de análise misto desse tipo sob MPC, e a primeira avaliação de inferência com VGG16 em SPDZ2k.
- **Relacional e séries temporais.** O CryptDough tem em média 1,5 vez a velocidade do ORQ nas consultas dele, e supera o TVA em todas as configurações menos uma, com latência até 2,7 vezes menor.
- **Inferência de ML.** Contra o Pigeon ele é competitivo e mais rápido na LAN, enquanto num cenário de RTT alto os circuitos de ReLU personalizados do Pigeon lhe dão vantagem. O CryptDough de thread única vence o Piranha em todos os casos menos um, com inferência até 2,2 vezes mais rápida. Contra o MP-SPDZ ele vence na LAN e na WAN, com tempo de inferência até 4,7 vezes menor na WAN.
- **Escalabilidade.** Comparação e soma escalam quase perfeitamente até 8 threads, cerca de 2 vezes a cada dobra, e cerca de 1,5 vez de 16 para 32. A convolução, com alta razão entre comunicação e computação, ganha de 1,45 a 1,1 vez a cada dobra. O bitonic sort e o quicksort, escritos como fluxo de controle oblivious de thread única, são paralelizados pelo runtime.
- **Esforço.** Escrever uma consulta relacional diretamente a partir das primitivas de baixo nível leva cerca de 800 linhas mesmo com a API vetorizada, e cerca do dobro numa versão anterior do código sem ela.

## Análise crítica

O artigo declara vários limites por conta própria.

- **Sem tolerância a falhas nem expansão horizontal.** Cada parte é um servidor e uma falha reinicia a computação. Os autores dizem que as implantações reais de MPC têm pouquíssimas partes e que a escala horizontal dentro de uma parte é trabalho futuro.
- **Os vetores virtuais não são verificados.** Nada confere em tempo de compilação ou de execução que um desenvolvedor os use corretamente, o que depende de os estágios oblivious não terem conflitos. O embaralhamento oblivious exige acesso aleatório, então a maior parte dele roda em thread única.
- **As linhas de base às vezes usam protocolos melhores.** Os autores notam que alguns protocolos das linhas de base são mais eficientes que os implementados no CryptDough, o que favorece a linha de base, e que deixam de fora o protocolo Fantastic Four do ORQ por causa de um ataque publicado cuja correção estava em andamento.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A alegação central não é medida.** O argumento a favor de um motor unificado se apoia em evitar o custo de costurar sistemas (inicialização, recompartilhamento, materialização de compartilhamentos intermediários), mas esse custo só é estimado, e o pipeline é pequeno (64 imagens, 1 mil registros, 16 mil leituras). As comparações mostram que o CryptDough não perde muito em cargas isoladas, não quanto o usuário ganha nas mistas.
- **Hardware misto e estatística rala.** A comparação com o Piranha põe GPUs na AWS contra CPUs em bare-metal, os resultados são médias de três execuções sem dispersão, e os números de maioria desonesta deixam de fora a fase offline, que é a cara nesses protocolos.
- **A segurança é herdada, não demonstrada.** O sistema afirma as garantias dos protocolos de base e esconde até os tamanhos intermediários e de saída, o que exige limites de padding. O texto que li não traz prova de composição das camadas nem análise de vazamento dos vetores virtuais, e o custo do padding não é reportado em separado.
- **A expressividade tem preço.** Sem laços nem condicionais sobre dados privados, qualquer programa fora dos operadores vetoriais precisa ser escrito por um especialista uma camada abaixo, e os exemplos do artigo são operadores e modelos das bibliotecas dos próprios autores. O treinamento não é coberto, só a inferência.
- **A manutenção de quatro protocolos não está provada.** A extensibilidade é argumentada com quatro protocolos escritos pelos autores, e a avaliação não mostra um criptógrafo externo acrescentando um. Os mapeamentos de índices dos vetores virtuais são materializados em memória, o que os autores indicam como um ponto de projeto que ainda revisitam.

## Pesquisas futuras

- Tolerância a falhas e execução distribuída dentro de cada parte lógica, e suporte a muito mais partes.
- Verificação em tempo de compilação ou de execução do uso de vetores virtuais, e melhor paralelização do embaralhamento oblivious.
- Implementações alternativas dos vetores virtuais (baseadas em iteradores, expression templates) para evitar materializar os mapeamentos de índices, e um otimizador que misture protocolos dentro de um mesmo pipeline.
- Medir o ganho de ponta a ponta sobre sistemas costurados em grandes pipelines mistos, e estender as bibliotecas para análise de grafos e para treinamento.
