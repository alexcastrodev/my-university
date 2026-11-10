---
title: "Em busca de um algoritmo de consenso compreensível"
summary: O Raft é um algoritmo de consenso para um log replicado, projetado antes de tudo para ser fácil de aprender e de usar como base, com líder forte, eleições aleatorizadas e uma forma segura de mudar a composição do cluster.
researchArea: Sistemas distribuídos
keywords: consenso, raft, paxos, log replicado, eleição de líder, replicação de máquina de estados
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Um algoritmo de consenso permite que um grupo de máquinas se comporte como um sistema coerente que sobrevive à falha de alguns membros. Ele está na base de serviços de lock, repositórios de configuração e bancos replicados. Por cerca de uma década a resposta padrão foi o Paxos, e os autores deste artigo, de Stanford, argumentam que ele é difícil de aprender e dá pouco ponto de partida a quem constrói sistemas, já que a descrição comum cobre uma única decisão e deixa para o leitor o log replicado, que é a parte de que os sistemas realmente precisam.

Este artigo do USENIX ATC 2014 adota um objetivo incomum: a compreensibilidade como principal critério de projeto. O resultado é o Raft, que os autores apresentam como equivalente ao multi-Paxos no que garante e igualmente eficiente, mas organizado para que as pessoas consigam raciocinar sobre ele.

Vale conhecer antes: máquinas de estados replicadas (servidores que aplicam os mesmos comandos na mesma ordem), a ideia de quórum por maioria e o modelo de falhas usado aqui, em que servidores param e podem voltar, e mensagens podem atrasar, se perder ou chegar fora de ordem, mas ninguém mente.

## Contribuição

- **Decomposição.** O Raft separa eleição de líder, replicação do log, segurança e mudanças de composição, de modo que cada parte pode ser explicada sozinha.
- **Um líder forte.** As entradas do log fluem apenas do líder para os demais servidores, o que elimina classes inteiras de casos que um protocolo simétrico precisa tratar.
- **Timeouts de eleição aleatórios.** As eleições reaproveitam o mecanismo de heartbeat e resolvem conflitos com um pequeno atraso aleatório.
- **Consenso conjunto para mudanças de composição.** Durante uma mudança, as decisões precisam da maioria da configuração antiga e da nova ao mesmo tempo, então o cluster continua funcionando enquanto muda.
- **Um estudo com usuários** que compara o quanto estudantes aprendem Raft e Paxos, o que transforma a compreensibilidade em algo que o artigo tenta medir.

## Metodologia

Os autores projetaram comparando alternativas pela dificuldade de explicar cada uma, com duas técnicas: dividir o problema em partes independentes e reduzir o espaço de estados, por exemplo nunca permitindo buracos no log e limitando as formas como os logs podem diferir.

A avaliação tem três partes. Para a compreensibilidade, 43 estudantes de um curso de sistemas operacionais de Stanford e de um curso de computação distribuída de Berkeley assistiram a uma aula em vídeo sobre cada algoritmo e fizeram um teste depois de cada uma, com cerca de metade começando pelo Paxos e metade pelo Raft. Os autores tomaram medidas contra o viés: o mesmo professor, testes pareados por dificuldade, correção com rubrica em ordem aleatória. Para a corretude, escreveram uma especificação em TLA+ de cerca de 400 linhas e uma prova de segurança. Para o desempenho, implementaram o Raft em cerca de 2.000 linhas de C++ para o repositório de configuração do RAMCloud e mediram a eleição de líder em um cluster de cinco servidores.

## Resultados

Estes são os resultados relatados pelos autores.

- 33 dos 43 estudantes tiraram nota maior no teste de Raft do que no de Paxos. A média foi 25,7 de 60 pontos para o Raft e 20,8 para o Paxos, e um teste t pareado coloca a diferença verdadeira em pelo menos 2,5 pontos com 95% de confiança.
- Em uma pesquisa, 33 de 41 participantes disseram que o Raft seria mais fácil de implementar, e o mesmo número disse que seria mais fácil de explicar. Os autores observam que essa autoavaliação pode estar enviesada por conhecerem a hipótese deles.
- Uma prova mecânica da propriedade Log Completeness no sistema de provas do TLA, apoiada em alguns invariantes que não foram verificados mecanicamente, e uma prova informal de State Machine Safety de cerca de 3.500 palavras.
- Sem aleatoriedade, a eleição de líder levou mais de 10 segundos nos testes por causa de votos divididos repetidos. Com 5 ms de aleatoriedade a mediana de indisponibilidade foi de 287 ms, e com 50 ms o pior caso em 1.000 tentativas foi de 513 ms. Com timeouts de eleição de 12 a 24 ms, um novo líder levou 35 ms em média.
- Cerca de 25 implementações de terceiros já existiam na época, feitas a partir de rascunhos do artigo.

## Análise crítica

O artigo defende bem que estrutura ajuda e é incomum por testar essa afirmação. Mesmo assim, leia as evidências com cuidado.

- **O estudo é pequeno e próximo dos autores.** Os participantes são estudantes, muitos com contato anterior com o Paxos, os testes e a aula de Paxos foram preparados pelos autores do Raft, e os participantes conheciam a hipótese. Os autores mitigam isso e relatam eles mesmos o risco de viés, mas o resultado é evidência, não prova, de compreensibilidade.
- **O desempenho é mais argumentado do que medido.** A afirmação de que o Raft tem desempenho de Paxos se apoia na contagem de mensagens (uma ida e volta a uma maioria) e não em um benchmark direto. As medições cobrem apenas a eleição de líder.
- **Um líder forte é uma escolha de projeto com custo.** Todas as escritas passam por um servidor, então a capacidade dele limita a vazão. O artigo aponta batching e pipelining como ajuda, sem medi-los.
- **O modelo de falhas é estreito.** Servidores podem cair e voltar, mas um servidor defeituoso ou malicioso está fora do escopo, como no Paxos.
- **Algumas partes ficaram de fora pelo limite de páginas.** A interação com clientes (e a semântica linearizável) e a compactação do log ficam para o relatório estendido, e a prova de segurança é só parcialmente mecânica.

## Pesquisas futuras

- Leitura e escrita eficientes para clientes, por exemplo leituras que evitam o log sem perder a linearizabilidade.
- Trabalho de desempenho em batching, pipelining e capacidade do líder, com um benchmark que compare o Raft com variantes do Paxos sob a mesma carga.
- Estudos maiores ou mais variados sobre como as pessoas aprendem consenso, já que a compreensibilidade é a afirmação central do artigo.
- Provas totalmente mecanizadas do protocolo inteiro, incluindo mudanças de composição.
- Variantes que toleram falhas arbitrárias (bizantinas).
