---
title: "MapReduce: processamento simplificado de dados em grandes clusters"
summary: Dean e Ghemawat descrevem um modelo de programação em que o usuário escreve só uma função map e uma reduce, e uma biblioteca esconde particionamento, escalonamento, tolerância a falhas e comunicação entre milhares de máquinas comuns, usando a reexecução como principal forma de sobreviver a falhas.
researchArea: Sistemas distribuídos
keywords: mapreduce, processamento em lote, tolerância a falhas, reexecução, localidade de dados, stragglers
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

MapReduce é um modelo de programação e uma implementação associada para processar e gerar grandes conjuntos de dados. O usuário especifica uma função map, que processa um par chave/valor para gerar um conjunto de pares chave/valor intermediários, e uma função reduce, que combina todos os valores intermediários associados à mesma chave intermediária. Muitas tarefas do mundo real podem ser expressas nesse modelo, como o artigo mostra.

Programas escritos nesse estilo funcional são paralelizados automaticamente e executados em um grande cluster de máquinas comuns. O sistema de execução cuida dos detalhes de particionar os dados de entrada, escalonar a execução do programa entre as máquinas, tratar falhas de máquinas e gerenciar a comunicação necessária entre elas. Isso permite que programadores sem nenhuma experiência com sistemas paralelos e distribuídos usem com facilidade os recursos de um grande sistema distribuído.

A implementação do MapReduce roda em um grande cluster de máquinas comuns e é altamente escalável: uma computação típica processa muitos terabytes de dados em milhares de máquinas. Os programadores acham o sistema fácil de usar: centenas de programas MapReduce já foram implementados e mais de mil jobs MapReduce são executados nos clusters do Google todos os dias.

## Visão geral

Em 2004, os autores e muitos colegas no Google já tinham escrito centenas de programas de propósito específico que transformam dados brutos (documentos coletados na web, logs de requisições) em dados derivados (índices invertidos, representações do grafo de páginas, consultas mais frequentes). Cada computação era simples, mas rodá-la em centenas ou milhares de máquinas a enterrava sob código de paralelização, distribuição de dados e tratamento de falhas. Este artigo, apresentado no OSDI '04, em San Francisco, em dezembro de 2004, propõe uma única abstração, inspirada nas primitivas map e reduce do Lisp e de outras linguagens funcionais, que leva tudo isso para uma biblioteca.

O cluster por baixo é um conjunto de PCs comuns com discos IDE baratos, em que falhas de máquina são comuns, e os dados ficam no sistema de arquivos distribuído interno do Google, o GFS, que os replica. O artigo cita o GFS como o lugar de onde o MapReduce lê a entrada e onde grava a saída. Outros artigos de infraestrutura do Google neste catálogo, como o [serviço de locks Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e o [Spanner](/papers/spanner-globally-distributed-database), seguem o mesmo estilo de engenharia sobre clusters de máquinas comuns.

Vale conhecer antes: as noções funcionais de map e reduce, o que é um par chave/valor e a diferença entre uma tarefa que pode ser reexecutada com segurança (idempotente, determinística) e uma que não pode.

## Contribuição

- **Uma interface de duas funções.** `map (k1,v1) -> list(k2,v2)` e `reduce (k2,list(v2)) -> list(v2)`. A biblioteca agrupa os valores intermediários por chave e chama reduce uma vez por chave, entregando os valores por um iterador, de modo que listas maiores que a memória funcionam.
- **Uma implementação para grandes clusters de máquinas comuns.** Um master atribui M tarefas de map e R tarefas de reduce aos workers. A saída do map é particionada em R regiões no disco local do worker, os workers de reduce a buscam por chamada de procedimento remoto, ordenam por chave e gravam os arquivos finais.
- **Reexecução como mecanismo de tolerância a falhas.** As tarefas de um worker que falhou, inclusive as de map já concluídas (cuja saída estava no disco local dele), simplesmente rodam de novo em outro lugar. Commits atômicos das saídas das tarefas fazem o resultado coincidir com uma execução sequencial quando os operadores são determinísticos.
- **Refinamentos de desempenho.** Escalonamento que considera a localização dos blocos do GFS, muitas tarefas pequenas para balancear a carga, execuções de backup das últimas tarefas para cortar o atraso dos stragglers, além de função de particionamento definida pelo usuário, ordenação dentro da partição, combiner, descarte de registros ruins, modo de execução local, páginas de status e contadores.

## Metodologia

O artigo apresenta o modelo com o exemplo da contagem de palavras e uma lista de outras computações (grep distribuído, frequência de acesso por URL, grafo reverso de links, vetor de termos por host, índice invertido, ordenação distribuída), e depois descreve a implementação em C++ e o ambiente de cluster que ela atende. A discussão de projeto cobre as estruturas de dados do master, os casos de falha de workers e do master, a semântica quando os operadores são não determinísticos, a localidade, a granularidade das tarefas e as tarefas de backup.

A avaliação tem duas partes. Primeiro, dois programas de benchmark em um cluster de cerca de 1800 máquinas (dois processadores Xeon de 2GHz, 4GB de memória, dois discos IDE de 160GB e um link Ethernet gigabit cada): um grep sobre 10^10 registros de 100 bytes e uma ordenação de 10^10 registros de 100 bytes, modelada a partir do TeraSort, executados numa tarde de fim de semana, com o cluster quase ocioso. A ordenação também roda com as tarefas de backup desligadas e com 200 workers mortos de propósito. Segundo, estatísticas de uso no ambiente de produção do Google, incluindo a reescrita do sistema de indexação de produção.

## Resultados

Todos os números abaixo vêm do artigo.

- **Escala da configuração.** Os autores costumam usar M = 200.000 e R = 5.000 em 2.000 máquinas worker, escolhendo M para que cada tarefa leia de 16 MB a 64 MB de entrada. O master toma O(M + R) decisões de escalonamento e guarda O(M * R) de estado, cerca de um byte por par map/reduce.
- **Grep.** Varrer 10^10 registros atrás de um padrão presente em 92.337 deles chegou a mais de 30 GB/s com 1764 workers e levou cerca de 150 segundos, incluindo cerca de um minuto de sobrecarga de inicialização.
- **Ordenação.** Ordenar cerca de 1 terabyte leva 891 segundos na execução normal, com um programa de usuário de menos de 50 linhas. O artigo compara com o melhor resultado reportado do TeraSort, 1057 segundos. A taxa de leitura atinge cerca de 13 GB/s, acima da de shuffle e de saída, porque a maior parte da entrada é lida de discos locais.
- **Tarefas de backup.** Sem elas, a ordenação leva 1283 segundos, 44% a mais, porque as últimas 5 tarefas de reduce terminam 300 segundos depois das outras. O mecanismo costuma acrescentar no máximo alguns por cento de recursos.
- **Falhas de máquinas.** Matar 200 dos 1746 workers faz a ordenação terminar em 933 segundos, 5% a mais. Em outra execução, uma manutenção de rede deixou grupos de 80 máquinas inacessíveis por vários minutos e o job ainda assim terminou.
- **Adoção.** Em agosto de 2004 o Google executou 29.423 jobs, em média de 634 segundos e 157 máquinas worker, lendo 3.288 TB, produzindo 758 TB de dados intermediários e gravando 193 TB, com 79.186 dias-máquina. Os programas no repositório de código passaram de nenhum no início de 2003 para quase 900 no fim de setembro de 2004.
- **Indexação.** O sistema de indexação de produção, sobre mais de 20 terabytes de documentos brutos, virou uma sequência de cinco a dez operações MapReduce. Uma fase caiu de cerca de 3800 linhas de C++ para cerca de 700.

## Análise crítica

O artigo é franco e a ideia central resistiu ao tempo: um modelo restrito compra paralelismo e recuperação automáticos. Algumas limitações aparecem no próprio texto.

- **O master é um ponto único de falha.** A implementação aborta o job se o master morre, e os autores argumentam que isso é improvável e que os clientes podem tentar de novo.
- **Não há efeitos exatamente uma vez.** As saídas são confirmadas de forma atômica por renomeação, mas os efeitos colaterais do código do usuário precisam ser atômicos e idempotentes por conta da aplicação, e não existe two-phase commit entre vários arquivos. Os autores dizem que essa restrição nunca foi um problema na prática, o que é um relato deles mesmos.
- **A avaliação é estreita.** Dois benchmarks em um cluster quase ocioso, e uma comparação com o TeraSort de outro sistema, em outro hardware, que o próprio artigo chama apenas de "similar".
- **Tudo passa pelo disco.** Os dados intermediários vão para discos locais e os resultados para o GFS, e encadear jobs significa gravar e reler arquivos.

O que a literatura posterior mudou, e que não é afirmação do PDF: sistemas como o Spark (resilient distributed datasets, NSDI 2012) mantêm conjuntos de trabalho em memória e os recuperam por linhagem, o que serve melhor a jobs iterativos; o Dryad generalizou o formato de dois estágios para grafos de fluxo de dados arbitrários; pesquisadores de bancos de dados argumentaram, por exemplo em Pavlo et al. (2009), que bancos paralelos vencem o MapReduce em consultas estruturadas. O [Dataflow Model](/papers/dataflow-model-unbounded-out-of-order-data) estendeu depois o modelo de processamento do próprio Google para dados ilimitados e fora de ordem, um caso que este projeto em lote não trata. O Hadoop, de código aberto, tornou o modelo amplamente disponível fora do Google.

## Pesquisas futuras

- Ler o artigo do [Google File System](/papers/google-file-system), que define a camada de armazenamento e as premissas de localidade em que o MapReduce se apoia.
- Dryad, Spark e o Dataflow Model, para generalizações em memória, em grafo e em streaming.
- Implementar você mesmo um MapReduce simplificado: o primeiro laboratório do MIT 6.5840 (Distributed Systems) faz exatamente isso, com coordenador, workers e recuperação de falhas.
- Estudos sobre stragglers e execução especulativa, e sobre desbalanceamento (skew) no particionamento das chaves.
- Ferramentas de proveniência e depuração para jobs grandes, já que os recursos do próprio artigo são um modo local, páginas de status e contadores.
