---
title: "DuckDB: um banco de dados analítico embarcável"
summary: Um artigo de demonstração de quatro páginas que apresenta o DuckDB, um banco SQL em processo feito para análise, que combina execução vetorizada, armazenamento colunar e MVCC em uma biblioteca sem servidor e sem dependências.
researchArea: Bancos de dados
keywords: duckdb, banco de dados embarcado, olap, execução vetorizada, armazenamento colunar, mvcc
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

O SQLite mostrou que muitos programas querem um banco de dados que seja apenas uma biblioteca, sem servidor para instalar, e virou o motor SQL mais implantado do mundo. Mas o SQLite é feito para trabalho transacional (OLTP), com um motor orientado a linhas sobre B-trees, e seu desempenho em consultas analíticas (OLAP) é ruim. Quem analisa dados em R ou Python usa bibliotecas de data frames que lembram operadores relacionais, mas não têm otimizador de consultas nem armazenamento transacional.

Este artigo, uma demonstração do SIGMOD 2019 do CWI em Amsterdã, apresenta o DuckDB como a peça que faltava: um banco analítico que roda dentro do processo hospedeiro. É um artigo curto (quatro páginas) e descreve um sistema e uma demonstração, não um conjunto de experimentos, então leia-o como uma declaração de projeto.

Vale conhecer antes: a diferença entre OLTP e OLAP, armazenamento por linhas e por colunas, e a ideia de um banco embarcado que é ligado a uma aplicação em vez de um servidor chamado pela rede.

## Contribuição

- **Uma declaração de requisitos** para análise embarcada, tirada do sistema anterior dos autores, o MonetDBLite: eficiência em OLAP sem abrir mão do OLTP, estabilidade (uma falha ou falta de memória no banco não pode derrubar o hospedeiro), transferência barata de tabelas entre a aplicação e o banco no mesmo espaço de endereçamento e facilidade de embarcar sem dependências externas.
- **Um sistema feito para esse fim** que segue a estrutura clássica (parser, planejador, otimizador, motor de execução) com técnicas conhecidas escolhidas para essas necessidades, como um parser derivado do PostgreSQL, um otimizador baseado em custo com programação dinâmica para a ordem das junções, um motor de execução interpretado e vetorizado, MVCC serializável do HyPer e blocos colunares comprimidos com índices de mínimo e máximo.
- **Uma camada de API compatível com o SQLite**, para que aplicações possam trocar apenas religando.
- Código aberto sob a licença MIT.

## Metodologia

O artigo apresenta o projeto componente por componente. Escolhe a interpretação vetorizada em vez da compilação JIT por portabilidade, porque motores JIT dependem de grandes bibliotecas de compilador como o LLVM. Os vetores têm até 1.024 valores, com um vetor de bits separado para NULL e vetores de seleção para evitar mover dados depois de um filtro, e as consultas rodam em um modelo "Vector Volcano" que puxa blocos a partir da raiz do plano.

Para concorrência, o DuckDB atualiza os dados no lugar e guarda as versões antigas em um buffer de undo, uma variante de MVCC escolhida porque modificar tabelas em paralelo era um pedido frequente até de quem usa o banco para análise.

A avaliação é uma demonstração planejada: quatro computadores idênticos rodando SQLite, MonetDBLite, HyPer e DuckDB sobre dados TPC-H, com um botão físico que muda a quantidade de dados lida e uma tela com consultas por segundo e pressão de memória ao vivo. Em um segundo cenário a plateia propõe a consulta, para que os autores não possam escolher consultas em que seu sistema se destaca.

## Resultados

Estes são os resultados relatados pelos autores, e são poucos porque é um artigo de demonstração.

- Na época da escrita, o DuckDB executava todas as consultas do TPC-H e todas menos duas do TPC-DS, e passava a maior parte da suíte de testes lógicos do SQLite, com milhões de consultas.
- Os autores preveem, e ainda não medem, que todos os sistemas se comportarão de forma parecida com dados pequenos, e que só o DuckDB continuará funcionando com dados maiores em um dispositivo pequeno: o SQLite é limitado pela execução linha a linha, o MonetDBLite pela materialização de resultados intermediários e o HyPer pelo protocolo de socket para transferir resultados.
- O trabalho à frente incluía o novo layout de armazenamento, um gerenciador de buffer, paralelismo dentro de uma consulta e um escalonador que equilibre os recursos do DuckDB com os da aplicação hospedeira.

## Análise crítica

O DuckDB foi muito adotado desde então, mas este artigo é um retrato inicial, e isso importa para a leitura.

- **Sem números.** O artigo não contém medições de desempenho, então sua afirmação principal, de que o DuckDB é melhor que as alternativas para análise embarcada, é uma previsão para a demonstração. Publicações posteriores e benchmarks independentes são o lugar para buscar evidência.
- **Um artigo de sistema sem alegação de novidade.** Os autores dizem que nenhum componente é revolucionário e que a contribuição é a combinação escolhida para o caso de uso. É justo, mas faz do artigo um bom guia de técnicas atuais e menos uma fonte de ideias novas.
- **A comparação é montada pelos autores.** A escolha das bases de comparação e do esquema TPC-H favorece a história deles, embora o cenário com consulta escolhida pela plateia seja um contrapeso cuidadoso.
- **Problemas em aberto foram listados como trabalho futuro.** Paralelismo dentro da consulta, gerenciador de buffer e compartilhamento de recursos com o hospedeiro ainda não existiam, e eles decidem se ele se comporta bem dentro de um programa maior.

## Pesquisas futuras

- Benchmarks independentes e reproduzíveis de motores analíticos embarcados com tamanhos de dados e consultas realistas.
- Governança de recursos entre um banco embarcado e seu hospedeiro, para memória e threads.
- Interfaces eficientes entre data frames e o motor que evitem cópias.
- Tratamento de dados maiores que a memória em uma biblioteca que não tem servidor para gerenciar o buffer pool.
