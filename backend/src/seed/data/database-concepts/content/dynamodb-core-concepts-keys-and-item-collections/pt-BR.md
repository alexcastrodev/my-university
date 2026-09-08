---
version: 1.0
updatedAt: 2026-08-20
title: "Conceitos Centrais do DynamoDB: Chaves Primárias, Partições, e Item Collections"
summary: O vocabulário a partir do qual o DynamoDB é construído (tabelas, itens, atributos, chaves primárias simples versus compostas, LSIs versus GSIs), e o conceito que une tudo: uma item collection é todo item compartilhando uma partition key, que é por que eles vivem em um único nó de armazenamento e por que Query é a operação em torno da qual seu modelo inteiro é desenhado.
---
## Objective

Aprender as cinco palavras a partir das quais o resto do DynamoDB é construído (tabela, item, atributo, chave primária, índice secundário), e então ir um nível mais fundo nas duas que de fato decidem se seu modelo funciona: a chave primária (simples versus composta, partition key versus sort key) e a **item collection**, que o livro chama de "um dos conceitos mais importantes, mas menos discutidos, do DynamoDB." O fio condutor é uma única frase da conclusão do capítulo: "quase toda sua modelagem de dados vai estar focada em desenhar a chave primária certa e os índices secundários, de forma que você esteja construindo as item collections para atender suas necessidades."

## Use Cases

- Integrar um engenheiro cujo modelo mental é `CREATE TABLE` + `JOIN`, e precisar dos pontos precisos onde o vocabulário se alinha (item ≈ linha, atributo ≈ valor de coluna) e onde deliberadamente não se alinha (uma tabela guarda vários tipos de entidade; nenhum schema é declarado; não há join).
- Decidir, para uma tabela nova, se a chave primária deveria ser **simples** ou **composta**: a regra do livro é mecânica, não estética: uma chave simples te dá exatamente um item de cada vez, uma chave composta te dá a API `Query` e, portanto, "buscar muitos".
- Escolher entre um índice secundário local e um global em uma tabela que você está prestes a criar, quando a decisão de LSI é irreversível depois do `CreateTable` e a decisão de GSI não é.
- Depurar um `Query` que "deveria" funcionar mas não retorna nada ou lança exceção, geralmente porque quem chamou forneceu uma condição de sort key sem uma partition key exata, o que não é algo que o `Query` consegue fazer.
- Explicar a um time por que um `Scan` que filtra por `Status = 'ACTIVE'` não é o equivalente DynamoDB de uma cláusula `WHERE`, e por que o conserto é uma item collection diferente, em vez de um filtro melhor.
- Revisar um design onde um valor de partition key está prestes a receber a maior parte do tráfego (uma chave `TENANT#` para seu um cliente enorme, uma chave `DAY#2026-08-20` para as escritas de hoje) e precisar do vocabulário no nível de partição para tornar o risco concreto.

## Deep Dive

### Os cinco conceitos básicos

**Tabela.** "Um agrupamento de registros que conceitualmente pertencem juntos": similar em espírito a uma tabela relacional ou uma collection do MongoDB, e diferente de duas formas específicas. Primeiro, uma tabela relacional guarda um único tipo de entidade; Customers, Orders, e Inventory Items cada um ganha sua própria tabela, e um join os remonta. No DynamoDB "você frequentemente inclui múltiplos tipos de entidade na mesma tabela DynamoDB", precisamente para evitar esse join. Segundo, não há schema declarado: "no nível do banco de dados, o DynamoDB é sem schema, significando que a própria tabela não vai garantir que seus registros estejam em conformidade com um dado schema." O livro imediatamente fecha a porta que abre: "o fato de o DynamoDB (e outros bancos de dados NoSQL) serem sem schema não significa que seu dado não deveria ter um schema; esse caminho leva à loucura." O schema ainda existe; é reforçado no código da sua aplicação, em vez de pelo banco de dados.

**Item.** Um único registro. Comparável a uma linha, ou a um documento MongoDB.

**Atributo.** Um valor de dado tipado em um item, `Username` com valor `alexdebrie`. Como um valor de coluna relacional, "com a ressalva de que atributos não são obrigatórios em todo item, como são em um banco de dados relacional." Todo atributo ganha um tipo na escrita, e existem **dez** deles, que o livro agrupa em três famílias:

| Família | Tipos | Notas |
|---|---|---|
| Escalares | string, number, binary, boolean, null | Um único valor simples. O que a maioria dos seus atributos vai ser. |
| Complexos | list, map | Estrutura aninhada arbitrária. O livro usa uma list para Featured Deals em uma página inicial (Cap. 20) e um map para guardar o Payment Plan inteiro de uma Organization (Cap. 21). |
| Sets | string set, number set, binary set | Múltiplos valores únicos, todos do mesmo tipo. Usado no Cap. 21 para rastrear quais reações um User anexou a um issue ou pull request. |

O tipo não é cosmético: ele decide quais operações são legais depois. Um atributo number pode ser atomicamente incrementado ou decrementado por um `UpdateItem`; um atributo set permite checar a existência de um valor particular antes de atualizar o item. Sets em particular permitem "manter registro de itens únicos, tornando fácil rastrear o número de elementos distintos sem precisar fazer múltiplas idas e voltas ao banco de dados", e os tipos de documento se justificam quando você desnormaliza.

**Chave primária.** A única peça de estrutura que você *precisa* declarar na criação da tabela. É ou **simples** (um valor) ou **composta** (dois). Três regras decorrem dela, e todas as três são reforçadas pelo serviço: todo item precisa incluir a chave primária, ou a escrita é rejeitada; todo item é unicamente identificável por ela; e escrever um item com uma chave primária existente **sobrescreve** o item existente, a menos que você diga explicitamente que não deveria (nesse caso a escrita é rejeitada em vez disso). O veredito do livro sobre o quanto isso importa: "seleção e design de chave primária é a parte mais importante da modelagem de dados com o DynamoDB. Quase todo seu acesso a dado vai ser conduzido por chaves primárias, então você precisa escolhê-las sabiamente."

**Índice secundário.** A válvula de escape. "A forma como você configura suas chaves primárias pode permitir um padrão de acesso de leitura ou escrita, mas pode impedir você de lidar com um segundo padrão de acesso." Um índice secundário permite "remodelar seu dado em outro formato para consulta": você declara um esquema de chave para o índice, assim como fez para a tabela, a AWS copia itens da tabela base para o índice na forma remodelada, e você faz `Query` no índice.

### Simples versus composta: partition key e sort key

Existem exatamente dois tipos de chave primária:

- **Simples**: um único elemento, a **partition key**.
- **Composta**: dois elementos, uma **partition key** e uma **sort key**.

Uma nota de terminologia que vale a pena carregar: "você pode ocasionalmente ver uma partition key chamada de 'hash key' e uma sort key chamada de 'range key'." O livro padroniza em partition/sort, e a documentação atual da AWS também: mas a *API* nunca padronizou. `KeySchemaElement.KeyType` ainda aceita os valores literais `HASH` e `RANGE` hoje, então o vocabulário legado é o que você de fato digita em CloudFormation, CDK, e nos SDKs.

Qual você escolhe é decidido pelos padrões de acesso, e a consequência é marcante:

- Uma chave primária **simples** "permite que você busque apenas um item de cada vez. Funciona bem para operações um-para-um, onde você só está operando em itens individuais."
- Uma chave primária **composta** "habilita um padrão de acesso 'buscar muitos'. Com uma chave primária composta, você pode usar a API `Query` para pegar todos os itens com a mesma partition key. Você pode até especificar condições na sort key para restringir seu espaço de query."

Essa assimetria é toda a razão pela qual chaves compostas dominam modelos reais: são "ótimas para lidar com relações entre itens nos seus dados e para recuperar múltiplos itens de uma vez." Repare na forma do contrato de `Query` implícita aqui: a partition key é fornecida como uma **igualdade exata**, e apenas a sort key aceita uma condição (`begins_with`, `between`, `>`, e assim por diante). Não existe consultar um intervalo de partition keys.

### Índices secundários locais versus globais

Ambos os tipos de índice recebem um esquema de chave: uma partition key e, se você quiser uma, uma sort key. O que os separa é quanta liberdade você ganha e o que você paga por isso.

Um **índice secundário local** precisa reutilizar a partition key da tabela base e só pode mudar a sort key. O livro enquadra o encaixe com precisão: "isso pode ser um bom encaixe quando você frequentemente filtra seu dado pela mesma propriedade de nível superior, mas tem padrões de acesso para filtrar seu conjunto de dados ainda mais. A partition key pode agir como a propriedade de nível superior, e os diferentes arranjos de sort key vão agir como seus filtros mais granulares."

Um **índice secundário global** permite "escolher quaisquer atributos que você quiser para sua partition key e sua sort key", e é "usado com muito mais frequência com o DynamoDB devido à sua flexibilidade."

| | Esquema de chave | Momento de criação | Consistência | Throughput |
|---|---|---|---|---|
| Índice secundário local | Precisa usar a mesma partition key da tabela base | Precisa ser criado quando a tabela é criada | Eventual por padrão; pode optar por leituras fortemente consistentes ao custo de uso de throughput mais alto | Usa o throughput da tabela base |
| Índice secundário global | Pode usar qualquer atributo da tabela como partition e sort keys | Pode ser criado depois de a tabela existir | Apenas consistência eventual | Provisionado separadamente da tabela base |

Na coluna de consistência, o livro dá a versão de uma linha ("'consistência forte' significa que você vai obter a mesma resposta de nós diferentes ao consultá-los", enquanto "'consistência eventual' significa que você poderia obter respostas levemente diferentes de nós diferentes, conforme o dado é replicado") e então sinaliza sua própria simplificação em um box, apontando para Kleppmann para o tratamento real. A consequência operacional para GSIs: "o dado é replicado da tabela central para índices secundários globais de forma assíncrona. Isso significa que é possível que o dado retornado no seu índice secundário global não reflita as últimas escritas na sua tabela principal. O atraso na replicação da tabela principal para os índices secundários globais não é grande, mas pode ser algo que você precisa levar em conta na sua aplicação."

O próprio padrão do livro é inequívoco, e define a convenção para os 20 capítulos restantes: "em geral, eu opto por índices secundários globais. Eles são mais flexíveis, você não precisa adicioná-los no momento da criação da tabela, e você pode deletá-los se precisar. No restante deste livro, você pode assumir que todos os índices secundários são índices secundários globais."

A introdução do capítulo também promete **projeção**: quanto de cada item é copiado para o índice, mas adia a mecânica. A documentação atual da AWS é onde obtê-la: uma projeção de índice é `KEYS_ONLY`, `INCLUDE` (um subconjunto nomeado), ou `ALL`, escolhida na criação do índice e *não* alterável depois sem reconstruir o índice. O livro retorna a isso mais tarde em um contexto de performance: se você está buscando muitos itens e cada um carrega um atributo grande que você não precisa, "você pode precisar criar um índice secundário com uma projeção customizada que só copia certos atributos para o índice", porque uma expressão de projeção na tabela base é aplicada *depois* do limite de leitura de 1MB, não antes.

### Como uma partition key se torna uma partição física

Item collections só fazem sentido uma vez que você sabe o que acontece a uma partition key no caminho de entrada. O mecanismo, do capítulo seguinte: "quando uma requisição chega ao DynamoDB, o roteador de requisição olha para a partition key na requisição e aplica uma função de hash a ela. O resultado dessa função de hash indica o servidor onde aquele dado vai ser armazenado, e a requisição é encaminhada para aquele servidor para ler ou escrever o dado como solicitado." Isso é o que torna a camada de armazenamento horizontalmente escalável: "o DynamoDB pode adicionar nós de armazenamento adicionais infinitamente conforme seu dado escala."

A animação abaixo mostra esse mecanismo com seis valores de partition key e quatro partições. **A função de hash aqui é ilustrativa: mostra o mecanismo, não a real do DynamoDB.** A AWS nunca publicou o algoritmo de hash interno do DynamoDB, então isso usa o `hash()` embutido do motor de visualização (`String.hashCode()` do Java) puramente para tornar visível "uma chave entra, um slot determinístico sai." Não leia os posicionamentos específicos de slot como algo que o DynamoDB produziria; leia a *forma* do resultado.

```viz
type: formula
capacity = 4
slot = (capacity - 1) & spread(hash(item))
---
ACTOR#Tom Hanks
ACTOR#Natalie Portman
ACTOR#Julia Roberts
ACTOR#Meryl Streep
ACTOR#Tim Allen
ACTOR#Keanu Reeves
```

Percorra o trace e três propriedades se revelam, e todas as três são verdadeiras da coisa real:

- **Toda chave aterrissa em algum lugar, deterministicamente.** `ACTOR#Tom Hanks` resolve para a partição 2 nesta leitura, na próxima leitura, e em toda escrita. É por isso que o cliente precisa conhecer a partition key completa no momento da leitura: não há forma de buscar o item sem ela, porque não há forma de saber qual nó perguntar.
- **Partition keys diferentes compartilhando uma partição é normal, não um bug.** `ACTOR#Tom Hanks` e `ACTOR#Tim Allen` ambos caem no slot 2; `ACTOR#Natalie Portman` e `ACTOR#Keanu Reeves` ambos caem no slot 3. Diferente de um hash map, o DynamoDB não está tentando dar a cada chave seu próprio balde: uma partição é uma unidade de armazenamento guardando muitas chaves não relacionadas, e coabitação é o ponto.
- **A distribuição é só tão uniforme quanto seu espaço de chaves.** Quatro partições, seis chaves, e a carga já sai 1/1/2/2, em vez de um arrumado 1,5 cada. Adicione uma chave que toda escrita no sistema compartilha e nenhuma quantidade de hashing te salva: o hash de um único valor é um único valor, então resolve para exatamente uma partição. Esse é o modo de falha de partição quente, e é uma propriedade da *sua escolha de chave*, não do hash.

### Item collections: por que `Query` é a operação em torno da qual o modelo é construído

"Uma item collection se refere a um grupo de itens que compartilham a mesma partition key, seja na tabela base ou em um índice secundário." O exemplo condutor do livro é uma tabela de atores e os filmes em que atuaram, com uma chave composta de partition key `Actor` e sort key `Movie`. Quatro itens de papel em filme, dois deles com a partition key `Tom Hanks`: esses dois "são ditos estar na mesma item collection." E o caso de borda é sinalizado explicitamente: "o único papel em filme de Natalie Portman está em uma item collection, mesmo tendo apenas um item nela." Uma item collection de tamanho um ainda é uma item collection.

Duas razões pelas quais isso importa, na ordem do livro:

**Particionamento.** "O DynamoDB particiona seu dado através de vários nós, de uma forma que permite performance consistente conforme você escala. No entanto, todos os itens com a mesma partition key vão ser mantidos no mesmo nó de armazenamento." Siga isso de volta através da animação acima: partition keys idênticas fazem hash para o mesmo valor, então resolvem para o mesmo nó, necessariamente, não como uma otimização. Uma item collection *é* o conjunto de itens que a função de hash colocou no mesmo lugar.

**Modelagem de dados.** "A ação `Query` pode recuperar múltiplos itens dentro de uma única item collection. É uma operação eficiente, porém flexível." Eficiente porque o roteador faz um hash e lê dado contíguo, ordenado por sort key, de um nó: sem scatter-gather, sem coordenação entre nós, sem descartar linhas. Flexível porque a condição de sort key fatia a collection. Essa é toda a razão pela qual a sort key existe, e é por que a instrução final do livro para os capítulos seguintes é "pensar em como você está trabalhando para construir item collections feitas sob medida para satisfazer seus padrões de acesso."

Junte as peças e o ciclo de design é pequeno: um padrão de acesso que precisa de muitos itens se torna uma item collection; uma item collection é criada escolhendo uma partition key que agrupa exatamente esses itens; a sort key ordena e filtra dentro dela; e um índice secundário existe para criar um *segundo* conjunto de item collections sobre o mesmo dado, quando um agrupamento não é suficiente.

### Book vs. today

O capítulo envelheceu incomumente bem: o vocabulário, os dois tipos de chave, a tabela LSI/GSI, e o conceito de item collection ainda estão todos exatamente certos na documentação atual da AWS. Três notas:

> **A tabela comparativa LSI/GSI ainda é precisa, literalmente.** LSIs ainda precisam ser criados com a tabela e ainda não podem ser adicionados depois; GSIs ainda suportam apenas consistência eventual; LSIs ainda permitem optar por leituras fortemente consistentes a um custo de throughput mais alto. Nada aqui foi depreciado ou suavizado desde 2020, o que vale a pena dizer claramente, em vez de com ressalvas.

> **"Você precisa provisionar throughput adicional para o GSI" agora depende do modo.** No modo de capacidade provisionada, isso permanece literalmente verdadeiro: um GSI tem suas próprias configurações de RCU/WCU, separadas da tabela base. No modo on-demand (disponível quando o livro foi escrito, e agora o padrão comum para tabelas novas) não há nada para provisionar nem na tabela nem em seus índices; você é cobrado por requisição e o índice escala com a tabela. O fato subjacente que a frase está protegendo, **uma escrita de GSI é uma segunda escrita pela qual você paga**, permanece inalterado em ambos os modos. Só o botão desapareceu.

> **A mecânica de partição continua propositalmente não documentada.** "O roteador de requisição... aplica uma função de hash a ela" é tão específico quanto a AWS já foi publicamente, e é tão específico quanto qualquer um deveria ser. Capacidade adaptativa (que o livro observa que chegou antes de ele ser lançado) e trabalho de isolamento posterior significam que a camada de partição se move por baixo de você; a lição durável é a de cima, um único valor de partition key é um único ponto de concentração, não qualquer hash, contagem de partição, ou mapeamento chave-para-nó em particular.

## Trade-offs

- **Uma partition key mal escolhida produz uma partição quente, e o serviço não pode te resgatar dela.** O teto por partição é real e o livro o afirma: uma única partição atinge o máximo de 3000 RCU ou 1000 WCU por segundo, e "esses limites se aplicam a uma única partição, não à tabela como um todo." Uma tabela provisionada para 40.000 WCU ainda estrangula em 1000 WCU se toda escrita compartilha uma partition key, e capacidade adaptativa (que de fato redistribui throughput em direção aos itens que precisam dela) não consegue dividir o valor de uma partition key entre nós, porque fazer isso quebraria a garantia de que item collections vivem juntas. As mitigações são todas trabalho de modelagem, não configuração: fragmentar a escrita da chave (`DAY#2026-08-20#3` através de N sufixos) e pagar por uma leitura scatter-gather através de todo shard, ou encontrar uma chave que se espalhe naturalmente. O sinal de que você precisa disso é uma chave cuja cardinalidade é pequena ou cuja distribuição é distorcida: um status, um id de tenant em um negócio com uma baleia, um bucket de data.
- **400KB por item é o menor limite de item entre armazenamentos comparáveis, e limita diretamente a desnormalização.** O livro coloca isso em contexto deliberadamente: o MongoDB permite documentos de 16MB, o Cassandra um "incrível 2GB", e então argumenta que o limite é um recurso: "tamanhos de item grandes significam leituras maiores do disco, resultando em tempos de resposta mais lentos e menos requisições concorrentes." A consequência de modelagem é específica e morde exatamente onde a desnormalização é mais tentadora: "quando você tem um relacionamento um-para-muitos, você pode ser tentado a armazenar todos os itens relacionados no item pai, em vez de separá-los. Isso funciona para muitas situações, mas pode explodir se você tiver um número ilimitado de itens relacionados." Então o padrão *bom* (um atributo map ou list guardando os filhos, uma leitura para obter pai e filhos) só é seguro quando a contagem de filhos tem um teto superior real, reforçado. Se não tem, o item pai eventualmente rejeita escritas em produção, com dado já dentro dele, e o conserto naquele ponto é uma migração para itens separados mais uma nova item collection, não uma mudança de configuração. Decida limitado-versus-ilimitado no momento do design, e prefira itens separados sempre que você não conseguir defender o limite.
- **Consistência eventual do GSI é uma restrição de corretude, não uma nota de latência.** A tabela base pode servir leituras fortemente consistentes; um GSI não pode, nunca, por design. Ler-suas-próprias-escritas através de um GSI, portanto, não está disponível: crie um item e imediatamente consulte o índice por ele, e você pode legitimamente não receber nada de volta. Isso descarta o GSI para toda uma classe de uso: mais agudamente para reforço de unicidade, já que um fluxo de "checar o índice, então escrever" tem uma janela do tamanho do atraso de replicação, na qual duas requisições concorrentes ambas veem nada e ambas escrevem. Unicidade precisa viver na chave primária da tabela base (ou um item dedicado mais uma transação), onde a restrição é atômica. LSIs podem optar por consistência forte, mas você paga em throughput de leitura e precisa ter criado o índice com a tabela. A própria orientação do livro em outro lugar decorre disso: faça o máximo possível com a chave primária.
- **Item collections podem crescer sem limite, e com um LSI isso se torna uma falha de escrita rígida.** Com um índice secundário local presente, "uma única item collection não pode ser maior do que 10GB", contando a tabela base e todos os LSIs para aquela partition key. O aviso do livro é sobre *quando* você descobre: "se você tem um modelo de dados com muitos itens com a mesma partition key, isso pode te morder em um momento ruim, porque suas escritas vão de repente ser rejeitadas assim que você ficar sem espaço de partição." Nada degrada primeiro; uma partition key que acumulou por dois anos simplesmente para de aceitar escritas. Sem um LSI, o limite não se aplica: o DynamoDB divide uma collection de tamanho excessivo entre partições de forma transparente, então a troca é legível: um LSI compra leituras fortemente consistentes em uma sort key alternativa e um teto rígido de 10GB em toda item collection na tabela. Dado que cresce em forma (um log de evento por usuário, um histórico de mensagem por conversa) deveria ou evitar LSIs ou limitar a collection deliberadamente com TTL ou uma partition key em bucket de tempo.
- **Mesmo sem um LSI, uma item collection ilimitada é um problema de paginação de `Query`.** `Query` e `Scan` leem um máximo de 1MB por requisição, e esse limite "é aplicado antes de quaisquer expressões de filtro serem consideradas." Uma collection que cresce para sempre significa que um padrão de acesso que começou como uma requisição silenciosamente se torna um loop paginado, com latência por requisição que não reflete mais a latência total. O enquadramento do livro é que isso é o guardrail funcionando: o teto de 1MB é "crucial para manter a promessa do DynamoDB de tempos de resposta consistentes de um dígito", mas isso significa que "todos os itens para esta partition key" só é um padrão viável enquanto a collection é pequena, e "os N mais recentes" (uma condição de sort key mais um limit) é o padrão que permanece viável para sempre.
- **Sem schema no banco de dados significa que aplicação de schema agora é trabalho da sua suíte de testes.** A liberdade é genuína: nenhuma migração para adicionar um atributo, itens heterogêneos em uma tabela, um `Query` que retorna três tipos de entidade de uma vez. O custo é que nada rejeita um nome de atributo digitado errado, uma string onde deveria haver um number, ou um item escrito por um deploy antigo que não tem um atributo que um novo caminho de código assume. Não há `NOT NULL`, nenhuma checagem de tipo, e nenhuma migração falhando para capturar isso: a escrita tem sucesso e o bug aparece mais tarde no momento da leitura, em código, frequentemente em um serviço diferente. O "esse caminho leva à loucura" do livro é o instinto certo; operacionalmente significa que o schema precisa viver em algum lugar real: uma camada de acesso a dados de escritor único, uma classe de modelo validada, ou um consumidor de stream que alarma em itens malformados, e essa camada agora é infraestrutura essencial que você possui e mantém.
- **Sobrecarregar uma tabela com vários tipos de entidade é o padrão correto, e é genuinamente pior de olhar.** É o que compra a leitura multi-entidade em uma única requisição, e força nomes de atributo genéricos `PK`/`SK`, porque uma partition key guardando um nome de organização para um item e um nome de usuário para outro não pode ser chamada de nenhum dos dois. As consequências são todas humanas: a visualização do console é ilegível de relance, um conjunto de dados exportado é heterogêneo, nenhum nome de atributo documenta o que guarda, e um `DescribeTable` diz a um recém-chegado quase nada sobre o modelo. O gráfico de entidade e o gráfico de padrão de acesso deixam de ser documentação e se tornam o único mapa. Orce tempo para mantê-los, porque sem eles o modelo é indocumentado por construção.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 2, "Core Concepts in DynamoDB", p. 40-50](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, DynamoDB Core Components (tables, items, attributes, primary keys, secondary indexes)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html) - doc
- [AWS Documentation, Partitions and Data Distribution](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html) - doc
- [AWS Documentation, Improving Data Access with Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html) - doc
- [AWS Documentation, Service, Account, and Table Quotas in DynamoDB (400KB item limit, 10GB item collection limit)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotasHowItWorks.html) - doc
- [AWS Documentation, Designing Partition Keys to Distribute Your Workload Evenly](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) - doc
- [AWS Documentation, Query API Reference (KeyConditionExpression)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html) - doc
