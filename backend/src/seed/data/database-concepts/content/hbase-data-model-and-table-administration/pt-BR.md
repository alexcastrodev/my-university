---
version: 1.0
updatedAt: 2026-08-20
title: "O Modelo de Dados do HBase, CRUD, e Administração de Tabela"
summary: O mapa multidimensional esparso, distribuído, ordenado do HBase (row key, column family, column qualifier, timestamp/versão para um valor de célula), CRUD e administração de tabela através do shell do HBase (create, put, get, scan, disable, alter, enable), e uma comparação explícita com o modelo wide-column do Cassandra, mesma linhagem do paper Bigtable e vocabulário de column-family, mas escritas coordenadas por master sobre HDFS e ZooKeeper com consistência forte no nível de linha, versus a arquitetura sem líder, de consistência ajustável, do Cassandra, além de uma checagem book-vs-today sobre o status de manutenção atual do HBase e a posição de mercado em mudança contra Cassandra/ScyllaDB e Bigtable/DynamoDB gerenciados.
---
## Objective

Aprender o modelo de dados do HBase (um mapa multidimensional esparso, distribuído, ordenado, com chave por row key, column family, column qualifier, e timestamp/versão) e o vocabulário básico de CRUD e administração de tabela do shell HBase: `create`, `put`, `get`, `scan`, `disable`, `alter`, `enable`. Pelo caminho, posicionar o HBase contra o Cassandra, o outro armazenamento wide-column que esta trilha já cobre em profundidade: ambos tomam emprestado "column family" da mesma linhagem Bigtable, mas divergem fortemente em arquitetura e consistência, e essa divergência é a coisa mais importante para lembrar do que o vocabulário compartilhado.

## Use Cases

- Ler um schema HBase não familiar e conseguir dizer, corretamente, qual parte do endereço de uma célula é a row key, qual é a column family, e qual é o qualifier, e por que nada disso exige uma lista de coluna predefinida da forma que um `CREATE TABLE` relacional exige.
- Decidir quantas column families uma tabela precisa, já que o HBase (diferente do Cassandra) armazena cada column family em seus próprios arquivos separados em disco e espera que essa decisão seja tomada antecipadamente, antes de a tabela guardar muito dado.
- Realizar administração básica no shell do HBase: criar uma tabela, inspecioná-la com `status` e `scan`, e tirá-la do ar com `disable` para mudar opções de column family com `alter` antes de trazê-la de volta com `enable`.
- Ler e escrever dado versionado (uma revisão de página, uma leitura de sensor, uma linha de log) onde o histórico de timestamp/versão embutido por célula do HBase remove a necessidade de construir essa contabilidade você mesmo.
- Reconhecer quando o modelo operacional do HBase (Hadoop/HDFS por baixo, clusters de cinco ou mais nós, escritas coordenadas por master) é a ferramenta errada para o trabalho: a maioria dos projetos novos abaixo de "muitos, muitos gigabytes" de escala, ou sem um investimento existente em Hadoop, são melhor atendidos pelo Cassandra, um serviço wide-column gerenciado na nuvem, ou algo completamente mais simples.

## Deep Dive

### O que o HBase é, nas próprias palavras do livro

O livro abre com um aviso que dobra como a frase mais útil do capítulo: "o Apache HBase é feito para trabalhos grandes, como uma pistola de pregos. Você nunca usaria o HBase para catalogar sua lista de vendas corporativa ou construir uma aplicação de lista de tarefas por diversão, assim como você nunca usaria uma pistola de pregos para construir uma casa de bonecas." E dobra a aposta na armadilha da falsa familiaridade: o HBase "armazena dado em baldes que chama de tabelas, que contêm células que aparecem na interseção de linhas e colunas. Parece um banco de dados relacional, certo? Errado! No HBase, tabelas não se comportam como relações, linhas não agem como registros, e colunas são completamente variáveis e não reforçadas por nenhum schema predefinido." O próprio enquadramento do livro para isso é direto: o HBase é "o gêmeo maligno, o duplo bizarro, se preferir, do RDBMS."

O HBase é um banco de dados orientado a coluna, construído sobre o **Bigtable**, "um banco de dados proprietário de alta performance, desenvolvido pelo Google e descrito no white paper de 2006 'Bigtable: A Distributed Storage System for Structured Data.'" Começou a vida como um pacote contrib para o Apache Hadoop e cresceu para um projeto Apache de nível superior. Vive dentro do ecossistema Hadoop, armazenando seu dado no HDFS e dependendo do Apache ZooKeeper para coordenação distribuída: uma arquitetura materialmente diferente da do Cassandra, coberta abaixo.

### O modelo de dados: um mapa multidimensional esparso, ordenado

A analogia mais simples do livro: "a maioria das linguagens de programação tem algum conceito de um mapa key/value... uma tabela no HBase é basicamente um mapa grande, bem, mais precisamente, um mapa de mapas." Em uma tabela HBase:

- **Row key**: uma string arbitrária (bytes não interpretados) que identifica uma linha. Linhas são armazenadas em ordem ordenada por row key, que é por que o design de row key conduz a performance de varredura do HBase, da mesma forma que o design de partition key conduz a do Cassandra.
- **Column family**: um agrupamento nomeado de colunas, declarado antecipadamente quando a tabela é criada (ou alterado depois, a custo real, veja abaixo). Column families são armazenadas em arquivos separados em disco.
- **Column qualifier**: a segunda metade do nome completo de uma coluna, não predefinida em lugar nenhum; qualquer linha pode introduzir um qualifier novo dentro de uma column family existente no momento da escrita. O nome completo da coluna é convencionalmente escrito `family:qualifier`, por exemplo `cf1:col1`.
- **Timestamp / versão**: todo valor de célula é marcado com uma versão, por padrão o horário de escrita em milissegundos desde a epoch. Escrever um novo valor para a mesma célula não sobrescreve o antigo; ele é mantido, indexado por timestamp, até um número configurável de `VERSIONS` retidas. O livro destaca isso como "muito legal", e "um que é único ao HBase entre os bancos de dados neste livro": a maioria dos bancos de dados exige que você construa rastreamento histórico você mesmo, mas "no HBase, versionamento vem embutido de fábrica."

Juntando na própria ilustração do livro: uma tabela com row keys `first` e `second`, e duas column families, `color` e `shape`. A linha `first` tem três colunas em `color` (qualifiers `red`, `blue`, `yellow`) e uma em `shape` (qualifier `square`); a tupla `first / color:red` endereça o valor `'#F00'`. Como o livro coloca, "a combinação de row key e nome de coluna (incluindo tanto family quanto qualifier) cria um endereço para localizar dado": e uma linha que não tem valor para uma dada coluna simplesmente não tem célula ali, em vez de um `null` armazenado. Essa é a metade "esparsa" de "mapa multidimensional esparso, distribuído, ordenado."

O conselho do livro sobre pensar em linhas: "eu recomendo pensar em linhas do HBase como sendo um pequeno banco de dados por si só. Cada célula no banco de dados pode ter muitos valores diferentes associados a ela (como um mini banco de dados de série temporal). Quando você busca uma linha no HBase, você não está buscando um conjunto de valores; você está buscando um pequeno mundo."

### Por que column families existem

O livro faz a pergunta óbvia diretamente: por que não pular column families e colocar tudo em uma? Duas razões dadas:

1. **Ajuste de performance independente.** "As opções de performance de cada column family são configuradas independentemente. Essas configurações afetam coisas como velocidade de leitura e escrita e consumo de espaço em disco."
2. **Separação física em disco.** "Column families são armazenadas em diretórios diferentes. Ao ler dado de linha no HBase, você pode potencialmente direcionar suas leituras para column families específicas dentro da linha e assim evitar buscas desnecessárias entre diretórios... especialmente em cargas de trabalho intensivas em leitura."

E uma garantia que vale a pena conhecer: "todas as operações no HBase são atômicas no nível de linha. Não importa quantas colunas sejam afetadas, a operação vai ter uma visão consistente da linha específica sendo acessada ou modificada."

### CRUD no shell do HBase

O shell é baseado em JRuby (`${HBASE_HOME}/bin/hbase shell`), e o livro percorre o básico construindo uma pequena wiki. Crie uma tabela com uma column family:

```
hbase> create 'wiki', 'text'
0 row(s) in 1.2160 seconds
```

Insira dado com `put` (tabela, row key, `family:qualifier`, valor):

```
hbase> put 'wiki', 'Home', 'text:', 'Welcome to the wiki!'
```

Repare no dois-pontos final: "isso na verdade é uma exigência no HBase se você não especificar uma column family além de uma coluna", aqui significando um qualifier vazio. Leia uma linha/coluna específica com `get`:

```
hbase> get 'wiki', 'Home', 'text:'
COLUMN    CELL
 text:    timestamp=1295774833226, value=Welcome to the wiki!
1 row(s) in 0.0590 seconds
```

E leia tudo em uma tabela com `scan`, que o livro sinaliza como útil para desenvolvimento, mas perigoso em escala de produção: "scans são poderosos e ótimos para propósitos de desenvolvimento, mas também são um instrumento muito contundente... se você está rodando o HBase em produção, fique com leituras mais precisas ou você vai colocar bastante pressão indevida nas suas tabelas."

Um `put` que define várias colunas de uma vez (tipicamente feito programaticamente, em vez de através do próprio `put` do shell, que só define uma coluna por chamada) marca todas com o mesmo timestamp, se nenhum for dado explicitamente:

```
hbase> get 'wiki', 'Home'
COLUMN             CELL
 revision:author   timestamp=1296462042029, value=jimbo
 revision:comment timestamp=1296462042029, value=my first edit
 text:             timestamp=1296462042029, value=Hello world
3 row(s) in 0.0300 seconds
```

### Administração de tabela: create, disable, alter, enable

Column families são declaradas no momento do `create`, mas suas *opções* (como quantas versões reter) podem ser mudadas depois, com uma pegadinha: mudanças de schema em atributos de column family exigem tirar a tabela do ar primeiro.

```
hbase> disable 'wiki'
0 row(s) in 1.0930 seconds
hbase> alter 'wiki', { NAME => 'text', VERSIONS =>
hbase*   org.apache.hadoop.hbase.HConstants::ALL_VERSIONS }
0 row(s) in 0.0430 seconds
hbase> alter 'wiki', { NAME => 'revision', VERSIONS =>
hbase*   org.apache.hadoop.hbase.HConstants::ALL_VERSIONS }
0 row(s) in 0.0660 seconds
hbase> enable 'wiki'
0 row(s) in 0.0550 seconds
```

O livro é explícito sobre o custo disso: "operações que alteram características de column family podem ser muito caras, porque o HBase precisa criar uma nova column family com as especificações escolhidas e então copiar todo o dado. Em um sistema de produção, isso pode incorrer em downtime significativo. Por essa razão, quanto antes você se decidir sobre opções de column family, melhor." Esse é o análogo HBase do "chaves primárias são para sempre" do Cassandra: uma decisão tomada cedo (quais families existem, e suas opções) que é deliberadamente cara de revisitar, porque governa o layout em disco.

Repare também no que `alter` *não* faz: adiciona ou reconfigura uma *column family*, nunca predefine colunas individuais. Como o livro coloca para a family `revision`, "estamos só adicionando uma column family revision ao schema da tabela, não colunas individuais... é responsabilidade do cliente honrar essa expectativa; não está escrito em nenhum schema formal. Se alguém quiser adicionar um `revision:foo` para uma página, o HBase não vai impedir." Essa ausência de uma lista de coluna reforçada, dentro de uma family cuja existência *é* reforçada, é o modelo de schema em miniatura.

### HBase vs. Cassandra: mesma ancestralidade, arquitetura diferente

Tanto o HBase quanto o Cassandra são armazenamentos wide-column na linhagem Bigtable, e ambos usam "column family" para um agrupamento nomeado de colunas: que é exatamente por que a sobreposição de vocabulário é mais perigosa do que útil. O próprio modelo de dados do Cassandra, coberto no conceito *CQL Fundamentals* desta trilha, constrói uma hierarquia aninhada de coluna → linha → **partição** → tabela → keyspace → cluster, onde uma chave primária composta (partition key mais clustering columns) decide tanto o posicionamento no nó quanto a ordem em disco. O modelo do HBase é column family → qualifier → row key → tabela, sem uma abstração de partição separada visível na camada de modelagem de dados: a row key sozinha determina a ordem de classificação e, indiretamente, qual region (um intervalo contíguo de row-key) e, portanto, qual servidor guarda o dado.

A diferença mais nítida é arquitetural, não lexical:

| | Cassandra | HBase |
|---|---|---|
| Caminho de escrita | Sem líder, peer-to-peer: qualquer nó pode coordenar uma escrita para qualquer partição | Coordenado por master: um único **HMaster** ativo atribui regions a **RegionServers**; o ZooKeeper rastreia o estado do cluster |
| Armazenamento subjacente | O Cassandra gerencia seu próprio motor de armazenamento diretamente em disco local | Construído em cima do **HDFS**: o HBase é uma camada de acesso aleatório sobre um sistema de arquivos desenhado para leituras sequenciais grandes |
| Modelo de consistência | Ajustável, historicamente inclinado a AP: níveis de consistência ajustáveis, resolução de conflito last-write-wins, nenhum ponto único de coordenação | Fortemente consistente por design, atômico no nível de linha: o livro afirma isso como um diferencial: "o HBase também faz garantias de consistência forte... o HBase garante atomicidade no nível de linha" |
| Implantação mínima viável | Escala para baixo razoavelmente; clusters pequenos são viáveis | O livro é enfático de que o HBase não escala para baixo: "diferente de bancos de dados relacionais, que às vezes têm problemas para escalar para fora, o HBase não escala para baixo. Se seu cluster HBase de produção tem menos de cinco nós, então, francamente, você está fazendo errado." |
| Dependência de ecossistema | Autocontido; nenhum serviço separado de coordenação ou sistema de arquivos exigido | Depende tanto do HDFS quanto do ZooKeeper como serviços separados em execução |

A consequência prática: recorrer ao HBase significa, na prática, recorrer a uma fatia do ecossistema Hadoop: você herda o HDFS e o ZooKeeper como dependências operacionais, queira ou não, que é um compromisso mais pesado do que erguer um cluster Cassandra. Em troca você obtém atomicidade no nível de linha e garantias de consistência forte que o modelo sem líder do Cassandra não oferece na mesma forma.

### Book vs. today

Várias coisas mudaram desde a edição de 2018 do livro, e importam mais do que o usual aqui, porque afetam se o HBase ainda é a resposta padrão que o livro o apresenta como sendo.

**Versão.** O livro foi escrito contra o HBase 1.2.1. A partir de meados de 2026, as linhas ativamente mantidas são as séries 2.5.x e 2.6.x: HBase 2.5.15 e 2.6.5 ambos foram lançados na primeira metade de 2026, com o HBase 3.0 em beta. Os comandos de shell cobertos aqui (`create`, `put`, `get`, `scan`, `disable`, `alter`, `enable`) permanecem inalterados no HBase atual; esta parte do livro envelheceu bem.

**Manutenção do projeto.** O HBase continua sendo um projeto Apache de nível superior com status "Ongoing" (em andamento), mais de cem committers, e lançamentos regulares de ponto ao longo de 2025 e adentrando 2026: não foi abandonado ou aposentado. A afirmação do livro de que é ativamente desenvolvido continua verdadeira.

**Posição de mercado, isso mudou, e o enquadramento do livro não envelheceu tão bem.** O livro apresenta o HBase como uma escolha natural, quase padrão, para cargas de trabalho de analytics de big data. Hoje, o Cassandra (e sua reescrita em C++ ScyllaDB) é o armazenamento wide-column mais amplamente implantado para projetos *novos*, precisamente porque não exige erguer um cluster Hadoop e HDFS/ZooKeeper junto com ele, e seu modelo operacional é mais simples. Notavelmente, o Pinterest, um grande usuário histórico do HBase, publicou um relato detalhado de depreciar o HBase em seu stack, citando alto custo de infraestrutura vindo da configuração típica de recuperação de desastre de seis réplicas do HBase e migrando para alternativas com custo menor por réplica de dado. O HBase ainda aparece em grandes empresas estabelecidas de loja Hadoop (firmas de serviços financeiros entre elas), onde já está embutido em um investimento existente em HDFS, mas raramente é a primeira recomendação para uma carga de trabalho wide-column greenfield em 2026.

**Alternativas gerenciadas na nuvem absorveram grande parte do caso de uso histórico.** O próprio livro antecipa isso, observando em um box que "o Cloud Bigtable não é 100% compatível com o HBase, mas no início de 2018 está muito perto" e sugerindo-o como uma alternativa de menor fardo operacional. Essa previsão se concretizou: o Google Cloud Bigtable, o descendente gerenciado do próprio paper em que o HBase foi modelado, agora é uma escolha comum para times que querem o modelo wide-column sem rodar HDFS, ZooKeeper, e RegionServers eles mesmos. Para times não comprometidos com o GCP, ofertas de Cassandra como serviço e o DynamoDB preenchem um nicho semelhante de "não operar o cluster você mesmo." O efeito líquido: o diferencial do HBase em 2018 (consistência forte mais proximidade com o ecossistema Hadoop) é menos único em 2026 do que era, porque ambas as metades daquela proposta de valor (consistência forte, e não precisar operar o cluster manualmente) agora estão disponíveis em outro lugar com menos peso operacional.

## Trade-offs

- **O vocabulário relacional é uma armadilha aqui também, e possivelmente pior do que no Cassandra.** "Tabela", "linha", e "coluna" todos existem no HBase, e nenhum significa o que um background em banco de dados relacional espera. Não há lista de coluna predefinida, nenhum schema reforçado abaixo do nível de column family, e não existe tal coisa como um `NULL`: uma coluna que não foi escrita simplesmente não está presente naquela linha. Ler um schema HBase com instintos SQL intactos vai produzir um modelo mental errado silenciosamente, não ruidosamente.
- **Decisões de column family são baratas de tomar e caras de desfazer.** Declarar column families no momento do `create` é rápido; mudar suas características depois exige `disable`, `alter`, `enable`, e o livro é direto ao dizer que isso "pode ser muito caro, porque o HBase precisa criar uma nova column family com as especificações escolhidas e então copiar todo o dado", com risco real de downtime em produção. Resolva column families cedo, da mesma forma que desenvolvedores Cassandra são orientados a resolver chaves primárias cedo: a coisa específica que é cara de mudar difere, mas a disciplina de "acerte antecipadamente" é a mesma lição duas vezes.
- **Atomicidade no nível de linha e consistência forte são o ganho genuíno pelo peso operacional adicionado.** Onde o Cassandra compra disponibilidade ajustável, sem líder, ao custo de semântica last-write-wins, o HBase compra operações de linha atômicas, consistentes, ao custo de um master coordenador, ZooKeeper, e um substrato HDFS por baixo: três serviços separados para rodar e raciocinar, em vez de um. Essa é uma troca real, não uma atualização de graça: você está escolhendo garantias de consistência que a lógica da sua aplicação não precisa construir sozinha, em troca de infraestrutura que a lógica da sua aplicação não precisa pensar, mas seus operadores absolutamente precisam.
- **Versionamento embutido é uma vantagem real, com um custo real de espaço em disco.** Toda célula mantém seu histórico até o limite `VERSIONS` configurado, sem código de aplicação extra: genuinamente conveniente para qualquer coisa em forma de histórico de revisão. Mas esse histórico ocupa espaço real e precisa de uma política de retenção (`VERSIONS`, TTL, ou configurações de compaction) decidida deliberadamente, ou se acumula indefinidamente.
- **O HBase não escala para baixo, e isso é uma troca de forma de implantação, não um bug.** O "menos de cinco nós e você está fazendo errado" do livro é uma restrição genuína: a arquitetura do HBase (distribuição de region, replicação HDFS, failover de master) assume um cluster não trivial para fazer sentido. Para uma carga de trabalho medida em megabytes ou poucos gigabytes, o custo operacional fixo de HDFS + ZooKeeper + HBase supera quase qualquer benefício que o modelo oferece: o próprio enquadramento pistola-de-pregos-versus-casa-de-bonecas do livro está correto e ainda se sustenta em 2026.
- **Em 2026, escolher o HBase para um projeto novo significa escolhê-lo em vez de opções operacionalmente mais simples, e essa escolha precisa de uma razão específica.** Investimento existente em HDFS, um time já familiarizado com HBase, ou uma necessidade específica de consistência forte no nível de linha dentro do ecossistema Hadoop são razões que ainda se sustentam. "É a escolha clássica de wide-column" não é: esse papel em grande parte passou para o Cassandra/ScyllaDB em implantações auto-gerenciadas e para Bigtable/DynamoDB em gerenciadas.

## Documentation Links

- [Eric Redmond and Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018), Chapter 3, "HBase", Introduction and Day 1](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/) - doc
- [Apache HBase Reference Guide](https://hbase.apache.org/book.html) - doc
- [Apache HBase Downloads](https://hbase.apache.org/downloads.html) - doc
- [Apache HBase, Project Information](https://hbase.apache.org/project-info.html) - doc
- [Google Cloud Bigtable Documentation](https://cloud.google.com/bigtable/docs) - doc
- [Pinterest Engineering, HBase Deprecation at Pinterest](https://medium.com/pinterest-engineering/hbase-deprecation-at-pinterest-8a99e6c8e6b7) - article
