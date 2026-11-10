---
title: "Seleção de caminhos de acesso em um sistema gerenciador de banco de dados relacional"
summary: Como o otimizador do System R transforma uma consulta SQL declarativa em um plano, estimando o custo de cada caminho de acesso e de cada ordem de junção e pesquisando as combinações com programação dinâmica.
researchArea: Bancos de dados
keywords: otimização de consultas, otimizador baseado em custo, ordem de junções, system r, sql, estimativa de seletividade
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

O SQL permite pedir dados sem dizer como obtê-los: qual índice usar, em que ordem juntar as tabelas, se deve ordenar antes. Alguém precisa escolher, e a escolha pode mudar o tempo de execução em ordens de grandeza. Este artigo do SIGMOD de 1979, do laboratório de pesquisa da IBM em San Jose, descreve como o System R, um dos primeiros sistemas de banco de dados relacionais, faz essa escolha automaticamente.

É a origem do otimizador de consultas baseado em custo, o projeto que os otimizadores da maioria dos bancos relacionais ainda seguem em linhas gerais. Lê-lo é uma boa forma de entender por que um banco pode executar um plano lento para uma consulta aparentemente simples.

Vale conhecer antes: o modelo relacional e as junções em SQL, o que é um índice (e um índice clusterizado em particular) e a diferença entre ler uma tabela em ordem e lê-la por acesso aleatório.

## Contribuição

- **Uma fórmula de custo.** Cada plano candidato recebe um custo igual ao número de leituras de página mais um peso vezes o número de chamadas à camada de armazenamento, que representa o trabalho de CPU. Minimizá-lo significa minimizar os recursos totais, e não o tempo de resposta da primeira linha.
- **Fatores de seletividade.** Para cada predicado o otimizador estima a fração de linhas que passam, usando estatísticas mantidas no catálogo, como o número de chaves distintas de um índice.
- **Ordens interessantes.** Um plano que produz linhas em uma ordem útil adiante (para ORDER BY, GROUP BY ou uma junção por merge) é mantido mesmo que não seja o mais barato, porque pode economizar uma ordenação.
- **Dois métodos de junção** (laços aninhados e varreduras com merge) e uma forma de escolher a ordem das junções.
- **Uma busca que não enumera todas as ordens.** A melhor forma de juntar as k primeiras relações não depende da ordem em que foram juntadas, então o melhor plano pode ser encontrado para subconjuntos de tabelas cada vez maiores.
- Tratamento de consultas aninhadas, correlacionadas ou não.

## Metodologia

O otimizador trabalha em um bloco de consulta por vez. Para cada tabela ele lista os caminhos de acesso (uma varredura por índice ou uma varredura completa) e os predicados que eles podem aplicar, e estima o custo com a fórmula acima. Para consultas de uma só tabela, mantém o caminho mais barato para cada ordem interessante, mais o mais barato sem ordem.

Para junções, constrói a árvore de busca de baixo para cima: soluções para relações individuais, depois pares, depois trios, mantendo para cada subconjunto apenas o plano mais barato por ordem interessante. Uma heurística reduz o espaço, juntando uma relação apenas quando ela tem um predicado de junção com as já juntadas, de modo que produtos cartesianos aconteçam o mais tarde possível. Subconsultas aninhadas que não se referem a tabelas externas são avaliadas uma vez e primeiro. As correlacionadas são reavaliadas para cada linha candidata, com um atalho quando o valor referenciado não mudou desde a linha anterior.

## Resultados

Estes são os resultados relatados pelos autores, e são breves.

- O artigo é sobretudo a descrição de um projeto. Na conclusão a avaliação ainda está em andamento e prometida para um artigo posterior.
- Os resultados preliminares são que os custos previstos muitas vezes não são exatos em valor absoluto, mas o otimizador escolhe o caminho ótimo na grande maioria dos casos. Em muitos casos a ordem dos custos estimados para todos os caminhos é a mesma da ordem dos custos medidos.

## Análise crítica

A importância do artigo está na estrutura da solução, e ele é um bom exemplo de ideia que durou. Os detalhes mostram a idade.

- **Quase nenhuma evidência empírica.** Não há benchmark, apenas a afirmação de uma concordância preliminar entre as ordenações de custo estimado e real. A afirmação de que o método encontra bons planos é, neste artigo, uma expectativa.
- **Estimativas frágeis.** A seletividade supõe distribuições uniformes de valores e predicados independentes, e usa valores padrão arbitrários quando faltam estatísticas (por exemplo um décimo para uma igualdade sem índice). Os erros se multiplicam ao longo de uma cadeia de junções. Trabalhos posteriores sobre histogramas e colunas correlacionadas enfrentam esses problemas, e o artigo não.
- **Um espaço de planos estreito.** A busca junta uma relação a mais por vez e poda as ordens de junção por heurística, então pode perder planos que uma busca mais ampla encontraria. Os autores aceitam isso para manter baixo o tempo de otimização.
- **Um modelo de custo datado.** Os pesos de E/S e CPU, uma única máquina e um buffer pool compartilhado entre usuários são suposições do hardware de 1979. Paralelismo, dados residentes em memória e execução distribuída não são cobertos.
- **O objetivo é o uso total de recursos,** e não a latência até a primeira linha ou a justiça entre usuários.

## Pesquisas futuras

- Melhor estimativa de cardinalidade: histogramas, amostragem e modelos de correlação entre colunas.
- Escolher planos que se adaptam durante a execução quando as estimativas se mostram erradas.
- Espaços de planos mais amplos, como planos que juntam dois resultados intermediários, com busca que continue acessível.
- Modelos de custo para sistemas paralelos, distribuídos e em memória.
- Medir com que frequência os otimizadores escolhem um plano ruim em cargas realistas, o que o artigo apenas promete fazer.
