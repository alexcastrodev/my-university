---
version: 1.0
updatedAt: 2026-08-20
title: "Escolhendo uma Shard Key no MongoDB: Distribuições Ascendentes, Hashed e por Zonas"
summary: A shard key decide em qual shard cada documento vai parar, e as três formas de distribuição do capítulo explicam as consequências. Uma chave ascendente afunila todo insert em um único max chunk, uma chave hashed espalha as escritas por igual ao particionar por intervalos um espaço de hash de 64 bits, mas nunca consegue atender uma consulta por intervalo direcionada, e uma chave baseada em localização mais zonas compra controle de posicionamento ao custo da ajuda do balancer, com a cardinalidade limitando até onde qualquer uma delas pode ser dividida.
---
## Objective

Aprender a escolher o campo (ou os dois campos) que decide onde cada documento de uma coleção shardeada vive fisicamente. O livro abre o capítulo com o que está em jogo: "A tarefa mais importante ao usar sharding é escolher como seus dados serão distribuídos", e logo acrescenta a restrição que torna isso tão consequente: "Depois que você shardeia uma coleção, não pode mudar sua shard key, então é importante escolher corretamente." O capítulo se organiza em torno de três coisas: um conjunto de perguntas a responder sobre a sua própria carga de trabalho *antes* de olhar qualquer chave candidata, três formas que a distribuição de uma chave pode assumir (ascendente, aleatória, baseada em localização) com o modo de falha que cada uma produz, e quatro estratégias concretas (hashed, GridFS com hash, firehose, multi-hotspot), além das válvulas de escape (zonas e `moveChunk` manual) para quando a distribuição automática não é o que você quer.

## Use Cases

- Shardear uma coleção pela primeira vez e precisar decidir entre `{"_id": 1}`, `{"username": "hashed"}` e uma chave composta, em que escolher a errada significa uma migração completa depois, não uma mudança de configuração.
- Diagnosticar um cluster shardeado em que um shard faz todo o trabalho de escrita e o balancer parece nunca alcançar: o sintoma clássico de uma shard key ascendente (um campo `date`, um `ObjectId`, um id autoincremental importado).
- Shardear um bucket do GridFS, em que os dois índices que o MongoDB cria para você em `fs.chunks` por acaso são chaves ascendentes e, portanto, ambos errados.
- Precisar de garantias de residência de dados (manter os documentos de usuários da UE em shards hospedados na UE por causa do GDPR), o que é uma shard key baseada em localização mais zone sharding, não uma preocupação da camada de aplicação.
- Rodar um cluster heterogêneo em que um shard é muito mais potente que os outros, e querer que a máquina rápida absorva todas as escritas novas (o "firehose") ou hospede apenas uma coleção crítica em latência.
- Receber uma shard key candidata com três valores distintos (`"logLevel"`, um código de país, um enum de status) e precisar explicar por que a cardinalidade limita até onde a coleção pode ser dividida.
- Revisar um design shardeado no ponto em que a decisão ainda é barata (antes de a coleção ter dados), porque o argumento real do capítulo é que esta é uma decisão de tempo de design com um custo em forma de migração se você errar.

## Deep Dive

### Fazendo um inventário: responda quatro perguntas sobre sua carga de trabalho primeiro

O capítulo se recusa a começar pelas chaves candidatas. Ele começa pela sua carga de trabalho, porque "para escolher uma boa shard key, você precisa entender sua carga de trabalho e como sua shard key vai distribuir as requisições da sua aplicação." E é honesto ao dizer que ler sobre isso não basta: "Isso pode ser difícil de imaginar, então tente montar alguns exemplos ou, melhor ainda, teste em um dataset de backup com tráfego de amostra. Esta seção tem muitos diagramas e explicações, mas nada substitui testar com os seus próprios dados."

Para cada coleção que você planeja shardear, responda:

1. **Até quantos shards você planeja crescer?** "Um cluster de três shards tem muito mais flexibilidade que um cluster de mil shards. À medida que um cluster cresce, você não deveria planejar disparar consultas que podem atingir todos os shards, então quase todas as consultas precisam incluir a shard key." Esta é a pergunta que elimina silenciosamente a maioria das chaves candidatas: uma consulta sem a shard key é um scatter-gather por todos os shards, tolerável com três shards e ruinoso com mil.
2. **Você está shardeando para diminuir a latência de leitura ou escrita?** Latência é "quanto tempo algo leva; por exemplo, uma escrita leva 20 ms, mas você precisa que leve 10 ms." Resolver latência "normalmente envolve enviar requisições para máquinas geograficamente mais próximas ou mais potentes", o que aponta para chaves baseadas em localização e zonas.
3. **Você está shardeando para aumentar o throughput de leitura ou escrita?** Throughput é "quantas requisições o cluster consegue atender ao mesmo tempo; por exemplo, o cluster faz 1.000 escritas em 20 ms, mas você precisa que faça 5.000 escritas em 20 ms." Resolver throughput "normalmente envolve adicionar mais paralelização e garantir que as requisições sejam distribuídas por igual pelo cluster", o que aponta para chaves aleatórias ou hashed.
4. **Você está shardeando para aumentar os recursos do sistema** (mais RAM por GB de dados)? "Se sim, você quer manter o tamanho do working set o menor possível."

As quatro respostas não são curiosidades; são a função de pontuação. Latência e throughput puxam em direções opostas, e a resposta sobre working set puxa contra a aleatoriedade. Uma chave só pode ser avaliada depois que você sabe qual das quatro está de fato comprando.

### Shard keys ascendentes, e o chunk quente que elas criam

"Shard keys ascendentes geralmente são algo como um campo `date` ou um `ObjectId`: qualquer coisa que aumente continuamente ao longo do tempo. Uma chave primária autoincremental é outro exemplo de campo ascendente, embora não apareça muito no MongoDB (a menos que você esteja importando de outro banco)."

Shardeie por `"_id"` em uma coleção que usa `ObjectId`s e o espaço de chaves é cortado em chunks de intervalos de `_id`, distribuídos entre (digamos) três shards em ordem aleatória. Agora insira um documento. Qual chunk o recebe? "A resposta é o chunk com o intervalo de `ObjectId("5112fae0b4a4b396ff9d0ee5")` até `$maxKey`. Ele é chamado de **max chunk**, por ser o chunk que contém `$maxKey`."

E então a frase que o capítulo inteiro foi construído para evitar: "Se inserirmos outro documento, ele também vai para o max chunk. Na verdade, todo insert subsequente vai para o max chunk! O campo `_id` de cada insert estará mais perto do infinito que o anterior (porque `ObjectId`s são sempre ascendentes), então todos irão para o max chunk."

Duas consequências decorrem disso, e o livro as chama de "interessantes (e muitas vezes indesejáveis)":

- **Todas as suas escritas são roteadas para um shard.** Não a maioria: todas. "Esse chunk será o único crescendo e se dividindo, já que é o único que recebe inserts." Chunks novos "se desprendem" do max chunk à medida que ele cresce, mas o novo max chunk continua no mesmo shard, ainda recebendo 100% dos inserts.
- **O balancer precisa trabalhar muito mais do que deveria.** "Esse padrão muitas vezes torna mais difícil para o MongoDB manter os chunks balanceados, porque todos os chunks estão sendo criados por um shard. Por isso, o MongoDB precisa mover chunks constantemente para outros shards em vez de corrigir os pequenos desequilíbrios que podem ocorrer em sistemas com distribuição mais uniforme."

O livro menciona uma mitigação do lado do servidor que chegou pouco antes de ele ser escrito: "No MongoDB 4.2, a mudança da funcionalidade de autosplit para o `mongod` primário do shard adicionou a otimização de top chunk para lidar com o padrão de shard key ascendente. O balancer decide em qual outro shard colocar o top chunk. Isso ajuda a evitar uma situação em que todos os chunks novos são criados em um único shard." Leia com cuidado: isso espalha onde os novos *chunks* são criados; não espalha para onde as novas *escritas* vão. A cada instante continua existindo exatamente um max chunk em exatamente um shard.

### Shard keys com distribuição aleatória

"No outro extremo do espectro estão as shard keys distribuídas aleatoriamente. Chaves distribuídas aleatoriamente podem ser nomes de usuário, endereços de e-mail, UUIDs, hashes MD5 ou qualquer outra chave que não tenha padrão identificável no seu dataset."

O livro não argumenta isso pela teoria; ele executa. Shardeie por um `x` aleatório entre 0 e 1, insira 10.000 documentos e conte onde cada um foi parar:

```
> for (var i = 0; i < 10000; i++) {
...     var id = ObjectId();
...     db.random.insert({"_id" : id, "x" : Math.random()});
...     findShard(id);
... }
> servers
{
    "spock:30001" : 2942,
    "spock:30002" : 4332,
    "spock:30000" : 2726
}
```

Note que mesmo com 10.000 inserts realmente aleatórios o resultado é 2726 / 2942 / 4332, não um organizado 3333 para cada: as fronteiras dos chunks caem onde caem. A propriedade que importa não é a uniformidade perfeita, é que "como as escritas são distribuídas aleatoriamente, os shards devem crescer aproximadamente no mesmo ritmo, limitando o número de migrações necessárias."

O custo é dito em uma frase, e é fácil passar por cima dela: "A única desvantagem das shard keys distribuídas aleatoriamente é que o MongoDB não é eficiente em acessar aleatoriamente dados além do tamanho da RAM. Porém, se você tem a capacidade ou não se importa com a perda de desempenho, chaves aleatórias distribuem bem a carga pelo cluster." É a pergunta 4 da seção anterior cobrando a conta: uma chave aleatória maximiza ao mesmo tempo o espalhamento das escritas e o tamanho do working set.

### Shard keys baseadas em localização e zonas

"Shard keys baseadas em localização podem ser coisas como o IP de um usuário, latitude e longitude, ou endereço." O livro amplia a definição imediatamente: "Elas não estão necessariamente ligadas a um campo de localização física: a 'localização' pode ser uma forma mais abstrata de como os dados deveriam ser agrupados. Em qualquer caso, uma chave baseada em localização é uma chave em que documentos com alguma semelhança caem em um intervalo com base nesse campo." O ganho é duplo, "colocar os dados perto de seus usuários e manter dados relacionados juntos no disco", mais um terceiro motivo que só cresceu desde 2019: "Também pode ser uma exigência legal para manter conformidade com o GDPR ou outra legislação semelhante de privacidade de dados. O MongoDB usa Zoned Sharding para gerenciar isso."

Shardeando por endereço IP, o livro fixa o bloco `56.*.*.*` do Serviço Postal dos EUA em `shard0000` e o bloco `17.*.*.*` da Apple em `shard0000` ou `shard0002`, sem se importar com onde o resto vive:

```
> sh.addShardToZone("shard0000", "USPS")
> sh.addShardToZone("shard0000", "Apple")
> sh.addShardToZone("shard0002", "Apple")
> sh.updateZoneKeyRange("test.ips", {"ip" : "056.000.000.000"},
... {"ip" : "057.000.000.000"}, "USPS")
> sh.updateZoneKeyRange("test.ips", {"ip" : "017.000.000.000"},
... {"ip" : "018.000.000.000"}, "Apple")
```

Dois detalhes nesse trecho são essenciais. Primeiro, os intervalos são semiabertos: a regra USPS "associa todos os IPs maiores ou iguais a 56.0.0.0 e menores que 57.0.0.0 ao shard da zona `USPS`". Segundo, os IPs são armazenados **como strings preenchidas com zeros** (`"056.000.000.000"`, não `"56.0.0.0"`), porque uma shard key particionada por intervalo em um campo string é ordenada lexicograficamente; sem o preenchimento, `"6.0.0.0"` fica depois de `"56.0.0.0"` e os intervalos das zonas perderiam o sentido. Uma chave baseada em localização só funciona se a ordem natural do campo coincidir com o agrupamento que você quer.

E zonas são orientações, não ações imediatas: "Quando o balancer mover chunks, ele vai tentar mover os chunks com esses intervalos para esses shards. Note que esse processo não é imediato. Chunks que não forem cobertos por um intervalo de zona serão movidos normalmente."

O livro destaca uma melhoria então recente que vale conhecer: "No MongoDB 4.0.3+, você pode definir as zonas e os intervalos de zona antes de shardear uma coleção, o que popula os chunks tanto para os intervalos de zona quanto para os valores da shard key, além de fazer uma distribuição inicial desses chunks. Isso reduz muito a complexidade de configurar zonas em uma coleção shardeada." Defina as zonas primeiro e depois shardeie; caso contrário, você paga pela migração de dados que foram posicionados antes de as regras existirem.

### Shard keys hashed

Esta é a resposta do capítulo ao hotspot da chave ascendente: "Para carregar dados o mais rápido possível, shard keys hashed são a melhor opção. Uma shard key hashed pode tornar qualquer campo distribuído aleatoriamente, então é uma boa escolha se você vai usar uma chave ascendente em muitas consultas, mas quer que as escritas sejam distribuídas aleatoriamente."

O preço é dito logo na frase seguinte: "A contrapartida é que você nunca consegue fazer uma consulta por intervalo direcionada com uma shard key hashed. Se você não vai fazer consultas por intervalo, porém, shard keys hashed são uma boa opção."

Configurar uma são dois comandos, um índice hashed e depois o shard:

```
> db.users.createIndex({"username" : "hashed"})
> sh.shardCollection("app.users", {"username" : "hashed"})
{ "collectionsharded" : "app.users", "ok" : 1 }
```

O sharding hashed faz algo que o sharding por intervalo não consegue: em uma coleção vazia, ele faz a divisão antecipadamente. "Se você criar uma shard key hashed em uma coleção que não existe, `shardCollection` se comporta de forma interessante: ele presume que você quer chunks distribuídos por igual, então cria imediatamente vários chunks vazios e os distribui pelo cluster." Com três shards, `sh.status()` mostra dois chunks em cada, e vale a pena olhar com atenção para as fronteiras:

```
shard key: { "username" : "hashed" }
chunks:
    shard0000       2
    shard0001       2
    shard0002       2
{ "username" : { "$MinKey" : true } }  -->> { "username" : NumberLong("-6148914691236517204") }  on : shard0000
{ "username" : NumberLong("-6148914691236517204") } -->> { "username" : NumberLong("-3074457345618258602") } on : shard0000
{ "username" : NumberLong("-3074457345618258602") } -->> { "username" : NumberLong(0) } on : shard0001
{ "username" : NumberLong(0) } -->> { "username" : NumberLong("3074457345618258602") } on : shard0001
{ "username" : NumberLong("3074457345618258602") } -->> { "username" : NumberLong("6148914691236517204") } on : shard0002
{ "username" : NumberLong("6148914691236517204") } -->> { "username" : { "$MaxKey" : true } } on : shard0002
```

Esses valores `NumberLong` não são arbitrários. `3074457345618258602` é 2^64 / 6, então as seis fronteiras são exatamente o espaço de inteiros de 64 bits com sinal cortado em seis intervalos iguais, dois por shard. Esse é o mecanismo inteiro em uma tela: **o sharding hashed não faz hash e módulo para escolher um shard; ele faz o hash da chave para um número de 64 bits e então particiona o espaço de hash por intervalos.** Os intervalos dos chunks são intervalos de valores de hash, e a atribuição de chunks a shards é assunto do balancer, exatamente como com qualquer outra shard key. O benefício de preparar os chunks: "ainda não há documentos na coleção, mas quando você começar a inseri-los, as escritas devem ser distribuídas por igual entre os shards desde o início. Normalmente, você teria que esperar os chunks crescerem, se dividirem e se moverem para começar a escrever em outros shards."

A animação abaixo percorre esse mecanismo com o campo usado ao longo do capítulo, `username` em `app.users`: seis nomes de usuário chegando em ordem alfabética, seis chunks (dois por shard, como na saída de `sh.status()` acima), e o hash de cada nome de usuário decidindo em qual dos seis intervalos do espaço de hash ele cai.

**A função de hash desta animação é ilustrativa: mostra o mecanismo, não a função real do MongoDB.** O índice hashed do MongoDB calcula um hash de 64 bits cujo algoritmo exato em nível de bits é um detalhe interno de implementação, não uma função especificada publicamente que você possa reimplementar; se você precisa do valor real para um documento, pergunte ao servidor com `convertShardKeyToHashed()` em vez de calculá-lo por conta própria. Por isso a animação usa o `hash()` embutido do motor de visualização (o `String.hashCode()` do Java) sobre um espaço de 32 bits, apenas para tornar visível "uma chave entra, um intervalo determinístico do espaço de hash sai". Não leia as atribuições específicas de chunks como algo que o MongoDB produziria; leia a *forma* do resultado.

```viz
type: formula
capacity = 6
chunkSize = 4294967296 / capacity
slot = floor((hash(item) + 2147483648) / chunkSize)
---
aliceroberts
bjornsvensson
carlos_mendes
dpatel
emma.wu
fatima_zahra
```

Aqui `capacity` é o número de chunks em que o espaço de hash é cortado (seis, igual ao cluster preparado do livro), `chunkSize` é 2^32 / 6, o substituto ilustrativo para o 2^64 / 6 do livro, e `slot` é o chunk cujo intervalo de hash contém o hash daquele nome de usuário. Percorra o rastro e quatro propriedades aparecem; as quatro valem para o sharding hashed real:

- **Entradas alfabeticamente adjacentes não caem nem perto umas das outras.** Os nomes de usuário chegam em ordem ascendente (`aliceroberts`, `bjornsvensson`, `carlos_mendes`, ...) e se espalham pelos chunks 0, 4, 2, 1, 0, 2. Esse espalhamento *é* a correção para o problema da chave ascendente: todo o motivo de fazer hash é que a ordem da entrada não diz nada sobre a ordem do hash.
- **E é exatamente por isso que consultas por intervalo morrem.** `db.users.find({username: {$gte: "a", $lt: "c"}})` cobre dois nomes adjacentes aqui, e eles ficam em dois chunks diferentes em dois shards diferentes. Estenda isso para uma coleção real e um intervalo sobre nomes de usuário toca praticamente todos os chunks do cluster. É o "você nunca consegue fazer uma consulta por intervalo direcionada com uma shard key hashed" do livro tornado concreto: o intervalo é contíguo no espaço de *username* e picotado no espaço de *hash*, e o espaço de hash é a única coisa que as fronteiras dos chunks conhecem.
- **O posicionamento é determinístico, e consultas de igualdade continuam direcionadas.** `dpatel` cai no chunk 1 neste insert e em toda leitura seguinte. O hash custa as consultas por intervalo, mas não as consultas pontuais: o `mongos` faz o hash do valor em um `find({username: "dpatel"})`, encontra o único chunk cujo intervalo contém esse hash e roteia para o único shard que o guarda.
- **Seis documentos são poucos demais para parecer uniforme, e essa é a lição honesta.** O rastro coloca três nomes em `shard0000` (chunks 0-1), dois em `shard0001` (chunks 2-3) e um em `shard0002` (chunks 4-5). Compare com o próprio experimento de 10.000 inserts do livro: 2726 / 2942 / 4332. O hash dá uniformidade *estatística* em volume, não uma garantia em um dado momento, e não dá nada se a cardinalidade do campo for baixa, porque o hash de um valor é um valor e, portanto, um chunk.

O livro fecha a seção com três limitações, todas ainda dignas de memorizar: "Primeiro, você não pode usar a opção `unique`. Como com outras shard keys, não pode usar campos de array. Por fim, saiba que valores de ponto flutuante são arredondados para números inteiros antes do hash, então 1 e 1.999999 terão o mesmo hash." Essa última é uma armadilha real: uma shard key hashed em um campo `double` colapsa silenciosamente todo valor fracionário de uma faixa inteira em um único hash.

### Shard keys hashed para o GridFS

O livro avisa sobre o vocabulário primeiro: "o termo 'chunks' está sobrecarregado, já que o GridFS divide arquivos em chunks e o sharding divide coleções em chunks", então ele usa "chunks do GridFS" e "chunks de sharding" do começo ao fim.

A configuração é um bom exemplo resolvido do capítulo inteiro, porque as duas chaves candidatas óbvias estão erradas pelo mesmo motivo. "Coleções do GridFS geralmente são excelentes candidatas a sharding, já que contêm quantidades enormes de dados de arquivos. Porém, nenhum dos índices criados automaticamente em `fs.chunks` é uma shard key particularmente boa: `{"_id" : 1}` é uma chave ascendente e `{"files_id" : 1, "n" : 1}` usa o campo `_id` de `fs.files`, então também é uma chave ascendente." As duas dão o hotspot do max chunk.

A correção, e por que ela é a certa: "se você criar um índice hashed no campo `"files_id"`, cada arquivo será distribuído aleatoriamente pelo cluster, e um arquivo estará sempre contido em um único chunk. É o melhor dos dois mundos: as escritas vão para todos os shards por igual, e ler os dados de um arquivo só vai precisar atingir um único shard."

Esse é o princípio geral por trás de toda boa chave hashed: faça hash do campo que identifica a *unidade que você lê junta*. Todos os chunks do GridFS de um arquivo compartilham um `files_id`, então fazer hash de `files_id` distribui os arquivos pelo cluster mantendo os bytes de cada arquivo contíguos em um shard. Faça hash de `_id` e você teria o mesmo espalhamento uniforme das escritas, mas espalharia os chunks de cada arquivo por todos os shards.

```
> db.fs.chunks.createIndex({"files_id" : "hashed"})
> sh.shardCollection("test.fs.chunks", {"files_id" : "hashed"})
{ "collectionsharded" : "test.fs.chunks", "ok" : 1 }
```

Quanto a `fs.files`: "pode ou não precisar ser shardeada, já que será muito menor que `fs.chunks`. Você pode shardeá-la se quiser, mas provavelmente não será necessário."

### A estratégia firehose

Às vezes o hotspot do max chunk é exatamente o que você quer. "Se você tem alguns servidores mais potentes que outros, pode querer deixá-los lidar com proporcionalmente mais carga que os servidores menos potentes. Por exemplo, suponha que você tenha um shard que aguenta 10 vezes a carga das outras máquinas. Felizmente, você tem outros 10 shards. Você poderia forçar todos os inserts a irem para o shard mais potente e então deixar o balancer mover os chunks mais antigos para os outros shards. Isso daria escritas com latência menor."

Você faz isso fixando deliberadamente o top chunk com uma zona:

```
> sh.addShardToZone("<shard-name>", "10x")
> sh.updateZoneKeyRange("<dbName.collName>", {"_id" : ObjectId()},
... {"_id" : MaxKey}, "10x")
```

"Agora todos os inserts serão roteados para esse último chunk, que sempre vai viver no shard da zona `10x`." Mas o intervalo que você acabou de fixar vai *de agora até o infinito*, e ele nunca expira sozinho: "intervalos de agora até o infinito ficarão presos nesse shard a menos que modifiquemos o intervalo da zona." Então a estratégia precisa de um job diário que avance a fixação: buscar a zona cujo `max` é `MaxKey`, definir seu `min` como um `ObjectId()` novo e salvar; "então todos os chunks do dia anterior poderão se mover para outros shards."

A segunda desvantagem diz respeito ao crescimento: "ela exige algumas mudanças para escalar. Se o seu servidor mais potente não der mais conta do número de escritas chegando, não há forma trivial de dividir a carga entre ele e outro servidor." Um firehose tem exatamente um bocal.

E então a regra mais seca do capítulo: "Se você não tem um servidor de alto desempenho para usar como firehose ou não está usando zone sharding, não use uma chave ascendente como shard key. Se usar, todas as escritas irão para um único shard."

### Multi-hotspot: aleatório primeiro, ascendente depois

Esta seção nomeia a tensão em torno da qual o resto do capítulo dança: "Servidores `mongod` isolados são mais eficientes fazendo escritas ascendentes. Isso entra em conflito com o sharding, já que o sharding é mais eficiente quando as escritas estão espalhadas pelo cluster." Escritas ascendentes são boas para uma máquina (acrescentam no fim do índice, páginas quentes continuam quentes) e péssimas para um cluster. O hash é bom para o cluster e abre mão da localidade *dentro* de cada shard.

O multi-hotspot compra as duas coisas: "A técnica descrita aqui basicamente cria vários hotspots (idealmente vários em cada shard), de modo que as escritas fiquem balanceadas por igual no cluster, mas, dentro de um shard, ascendentes."

O mecanismo é uma shard key composta com uma forma específica:

- **Primeiro campo: "um valor aleatório aproximado, com cardinalidade relativamente baixa."** A figura do livro usa um estado dos EUA. "Você pode imaginar cada valor da primeira parte da shard key como um chunk... se você inserir dados suficientes, deve acabar tendo aproximadamente um chunk por valor aleatório."
- **Segundo campo: uma chave ascendente** (`_id`). "Isso significa que, dentro de um chunk, os valores estão sempre aumentando... Assim, se você tivesse um chunk por shard, teria a configuração perfeita: escritas ascendentes em todos os shards."

O dimensionamento desse primeiro campo é toda a arte, e o livro dá os dois modos de falha. Poucos hotspots: "ter n chunks com n hotspots espalhados por n shards não é muito extensível: adicione um shard novo e ele não vai receber escritas, porque não há chunk quente para colocar nele." Hotspots demais: "ter, digamos, mil hotspots em um shard acaba sendo equivalente a escritas aleatórias." O alvo é "alguns chunks quentes por shard (para deixar espaço para crescer), mas não muitos."

Um detalhe mecânico explica por que o padrão é estável em vez de degenerar: "Depois que um chunk é dividido, só um dos novos chunks será um chunk quente: o outro ficará essencialmente 'morto' e nunca mais crescerá." Cada chunk `(state, _id)` cresce pela borda de cima até se dividir; a metade de baixo fica congelada para sempre e a metade de cima continua recebendo inserts ascendentes. "Você pode imaginar essa configuração como cada chunk sendo uma pilha de documentos ascendentes. Há várias pilhas em cada shard, cada uma subindo até o chunk ser dividido. Se as pilhas estiverem distribuídas por igual entre os shards, as escritas também estarão."

### Regras e orientações para shard keys

O enquadramento é a frase mais útil da seção: "Decidir por qual chave shardear e criar shard keys deveria lembrar a criação de índices, porque os dois conceitos são parecidos. Na verdade, muitas vezes sua shard key pode ser simplesmente o índice que você mais usa (ou alguma variação dele)." Seus padrões de consulta já disseram qual deveria ser a shard key: você os anotou como índices.

**Limitações.**

- "Shard keys não podem ser arrays. `sh.shardCollection()` vai falhar se alguma chave tiver um valor de array, e inserir um array nesse campo não é permitido."
- "Depois de inserido, o valor da shard key de um documento pode ser modificado, a menos que o campo da shard key seja um campo `_id` imutável. Em versões do MongoDB anteriores à 4.2, não era possível modificar o valor da shard key de um documento."
- "A maioria dos tipos especiais de índice não pode ser usada como shard key. Em particular, você não pode shardear por um índice geoespacial. Usar um índice hashed como shard key é permitido."

**Cardinalidade.** "Seja sua shard key saltando de um lado para o outro ou crescendo continuamente, é importante escolher uma chave com valores que variem. Como com índices, o sharding funciona melhor em campos de alta cardinalidade. Se, por exemplo, você tivesse uma chave `"logLevel"` com apenas os valores `"DEBUG"`, `"WARN"` ou `"ERROR"`, o MongoDB não conseguiria dividir seus dados em mais de três chunks (porque haveria apenas três valores diferentes para a shard key)."

Três valores distintos significam três chunks, o que significa que no máximo três shards podem guardar dados, para sempre, e o hash não salva você, porque fazer hash de um campo com três valores produz três hashes. A correção é compor: "Se você tem uma chave com pouca variação e quer usá-la como shard key mesmo assim, pode fazer isso criando uma shard key composta por essa chave e uma chave que varie mais, como `"logLevel"` e `"timestamp"`. É importante que a combinação das chaves tenha alta cardinalidade." Note que é a forma do multi-hotspot de novo: prefixo de baixa cardinalidade, sufixo ascendente de alta cardinalidade.

### Controlando a distribuição dos dados: zonas por coleção e sharding manual

"Às vezes, a distribuição automática dos dados não atende aos seus requisitos." O livro delimita a seção inteira logo no começo: "À medida que seu cluster fica maior ou mais movimentado, essas soluções se tornam menos práticas. Porém, para clusters pequenos, você pode querer mais controle."

**Zoneando coleções inteiras.** "O MongoDB distribui as coleções por igual entre todos os shards do seu cluster, o que funciona bem se você guarda dados homogêneos. Porém, se você tem uma coleção de logs de 'menor valor' que o resto dos dados, talvez não queira que ela ocupe espaço nos seus servidores mais caros. Ou, se você tem um shard potente, talvez queira usá-lo só para uma coleção de tempo real." Em vez de montar clusters separados, zoneie os shards e então mapeie o intervalo de chaves inteiro de uma coleção, de `MinKey` a `MaxKey`, para uma zona:

```
> sh.addShardToZone("shard0000", "high")
> sh.addShardToZone("shard0004", "low")
> sh.addShardToZone("shard0005", "low")
> sh.updateZoneKeyRange("super.important", {"<shardKey>" : MinKey},
... {"<shardKey>" : MaxKey}, "high")
> sh.updateZoneKeyRange("some.logs", {"<shardKey>" : MinKey},
... {"<shardKey>" : MaxKey}, "low")
```

"Isso diz: 'de menos infinito a infinito nesta coleção, guarde nos shards marcados como `high`.' Isso significa que nenhum dado da coleção `super.important` será guardado em outro servidor. Note que isso não afeta como as outras coleções são distribuídas: elas continuarão distribuídas por igual entre este shard e os outros." A coleção de logs "agora será dividida por igual entre `shard0004` e `shard0005`."

Quatro observações operacionais com as quais o livro é cuidadoso:

- Não é instantâneo: "Atribuir um intervalo de zona a uma coleção não a afeta instantaneamente. É uma instrução ao balancer dizendo que, quando ele rodar, esses são os destinos válidos para onde mover a coleção."
- Shards podem ter várias zonas ao mesmo tempo: o livro coloca os cinco shards que não são `high` na zona `"whatever"` para expressar "qualquer lugar menos a máquina rápida". "Shards podem ter quantas zonas você precisar."
- Não há posicionamento dinâmico: "Você não pode atribuir coleções dinamicamente, ou seja, não pode dizer 'quando uma coleção for criada, coloque-a aleatoriamente em um shard.' Porém, você poderia ter um cron job que fizesse isso por você."
- Esvaziar uma zona deixa os dados encalhados em vez de liberá-los: `sh.removeShardFromZone()` desfaz uma atribuição, mas "se você remover todos os shards das zonas descritas por um intervalo de zona... o balancer não vai distribuir os dados para lugar nenhum, porque não há locais válidos listados. Todos os dados continuam legíveis e graváveis; só não vão conseguir migrar até você modificar suas tags ou intervalos de tags." Para aposentar um intervalo, use `sh.removeRangeFromZone()`, e note que "o intervalo especificado precisa ser exatamente igual a um intervalo definido anteriormente para o namespace."

**Sharding manual.** "Às vezes, para requisitos complexos ou situações especiais, você pode preferir ter controle total sobre quais dados são distribuídos para onde. Você pode desligar o balancer se não quiser que os dados sejam distribuídos automaticamente e usar o comando `moveChunk` para distribuir os dados manualmente."

```
> sh.stopBalancer()
> while(sh.isBalancerRunning()) { print("waiting..."); sleep(1000); }
> db.chunks.find()                    // no banco config
> sh.moveChunk("test.manual.stuff",
... {user_id: NumberLong("-1844674407370955160")}, "test-rs1")
```

Parar o balancer é assíncrono ("se houver uma migração em andamento, essa configuração só terá efeito quando a migração terminar"), daí o loop de verificação. `moveChunk` recebe o **limite inferior** do chunk mais o nome do shard de destino.

O livro então argumenta contra tudo o que acabou de mostrar: "a menos que você esteja em uma situação excepcional, deveria usar o sharding automático do MongoDB em vez de fazê-lo manualmente. Se você acabar com um hotspot inesperado em um shard, pode acabar com a maior parte dos seus dados nele." E a armadilha específica: "não combine configurar distribuições incomuns manualmente com o balancer rodando. Se o balancer detectar um número desigual de chunks, ele simplesmente vai reembaralhar todo o seu trabalho para deixar a coleção balanceada de novo. Se você quer uma distribuição desigual de chunks, use a técnica de zone sharding." Posicionamento manual com o balancer ligado não é uma vitória parcial: é trabalho desfeito em silêncio.

### Livro vs. hoje

O *raciocínio* do capítulo envelheceu extremamente bem: as quatro perguntas sobre a carga de trabalho, as três formas de distribuição, a mecânica dos hotspots, a regra da cardinalidade e as receitas de zona continuam sendo exatamente como se pensa sobre isso. Vários fatos mecânicos ao redor mudaram.

> **"Depois que você shardeia uma coleção, não pode mudar sua shard key" é a única afirmação que deixou de ser verdadeira, e é a premissa de abertura do capítulo.** Dois recursos do servidor chegaram depois do livro: `refineCollectionShardKey` (MongoDB 4.4) permite *acrescentar* campos de sufixo a uma shard key existente (útil justamente para a correção de cardinalidade acima, transformando `{logLevel: 1}` em `{logLevel: 1, timestamp: 1}` no lugar) e `reshardCollection` (MongoDB 5.0) faz um resharding online completo para uma shard key totalmente diferente. O MongoDB 8.0 foi além, adicionando `unshardCollection` e `moveCollection` e tornando o resharding bem mais rápido. Então a decisão agora é reversível, o que é uma mudança real. Mas não é barata: o resharding reescreve todos os documentos da coleção em uma nova distribuição, precisa de folga para uma segunda cópia e é um projeto de operações, não uma mudança de configuração. Trate a regra do livro como um conselho de *engenharia* sólido com um absoluto desatualizado: escolha como se não pudesse mudar, e fique feliz por poder.

> **`ensureIndex()` não existe mais; use `createIndex()`.** O trecho do GridFS no livro diz `db.fs.chunks.ensureIndex({"files_id" : "hashed"})`. `ensureIndex` foi descontinuado no MongoDB 3.0 e removido no MongoDB 5.0; o exemplo de código acima usa `createIndex`, que é o que o próprio exemplo de `username` hashed do livro já usava. Uma simples renomeação, sem mudança de comportamento.

> **Shard keys hashed compostas removeram a principal restrição do livro para chaves hashed.** O livro observa que "até o momento em que este texto foi escrito, o `mongos` não consegue usar um subconjunto do índice composto como shard key", e é por isso que a configuração do GridFS precisa de um índice hashed dedicado de campo único em `files_id`. O MongoDB 4.4 adicionou índices hashed compostos: uma shard key composta agora pode conter exatamente um campo hashed ao lado de campos de intervalo, em qualquer posição. Isso importa principalmente para os padrões multi-hotspot e de zonas: agora você pode escrever uma shard key como `{region: 1, userId: "hashed"}` e obter posicionamento zoneável e consultável por intervalo no prefixo, com espalhamento por hash dentro dele, algo que em 2019 exigia escolher um ou outro.

> **O modelo mental de contar chunks foi substituído pelo tamanho dos dados.** A narrativa do livro (chunks "se desprendendo" do max chunk via autosplit, e "se o balancer detectar um **número** desigual de chunks, ele simplesmente vai reembaralhar todo o seu trabalho") descreve o balancer anterior ao 6.0. O MongoDB 6.0 mudou o balancer para equilibrar o *tamanho dos dados* por shard em vez da contagem de chunks, e o auto-splitting foi removido em seguida (chunks agora são divididos apenas como parte de uma migração). As consequências de uma shard key ascendente não mudaram (um shard continua absorvendo todo insert), mas "contar os chunks por shard" deixou de ser a forma de diagnosticar desequilíbrio; `sh.status()`, `db.collection.getShardDistribution()` e `sh.balancerCollectionStatus()` informam por tamanho. A nota sobre a "otimização de top chunk" do 4.2 é história, não mecânica atual.

> **O trecho `findShard` de 10.000 inserts não roda como está escrito.** Ele lê `db.random.find({_id:id}).explain()` e depois percorre `explain.shards[i][0].server`, que é o formato legado de saída do `explain`, substituído pela estrutura `queryPlanner`/`executionStats` no MongoDB 3.0. O experimento ainda vale a pena reproduzir; faça com `db.collection.getShardDistribution()` ou `explain("executionStats")`. O *resultado* medido (aproximadamente uniforme, não exatamente) é a parte duradoura.

> **As zonas não mudaram.** `sh.addShardToZone()`, `sh.updateZoneKeyRange()`, `sh.removeShardFromZone()` e `sh.removeRangeFromZone()` continuam sendo a API atual, e o comportamento de "definir as zonas antes de shardear para pré-popular os chunks", que o livro credita ao 4.0.3+, continua sendo como a documentação manda fazer. Vale dizer isso com clareza em vez de hesitar: as receitas de zona deste capítulo, incluindo o firehose, podem ser digitadas em um cluster atual exatamente como estão escritas.

> **Limitações de chaves hashed: em grande parte iguais, e uma que vale reafirmar com precisão.** Sem opção `unique` e sem campos de array continuam valendo. O aviso sobre ponto flutuante também continua valendo e documentado: um índice hashed trunca um `double` para um inteiro de 64 bits antes do hash, então `1` e `1.999999` realmente colidem. Sobre o hash em si: o MongoDB nunca publicou o algoritmo como uma especificação reimplementável, e é por isso que a animação acima é apresentada como ilustrativa; `convertShardKeyToHashed()` é a forma suportada de obter um valor hashed real.

## Trade-offs

- **Uma shard key ascendente concentra 100% dos inserts em um shard, e o cluster não consegue corrigir isso por você.** Este é o modo de falha central do capítulo e merece a afirmação mais afiada: com uma shard key `ObjectId` ou `date`, "todo insert subsequente vai para o max chunk", então um cluster de dez shards tem o throughput de escrita de um shard. O dano não é só no throughput: o balancer agora fica permanentemente correndo atrás, "movendo chunks constantemente para outros shards em vez de corrigir os pequenos desequilíbrios que podem ocorrer em sistemas com distribuição mais uniforme", o que significa tráfego de migração contínuo disputando recursos com a sua carga de trabalho por exatamente tanto tempo quanto você continuar inserindo. A otimização de top chunk do 4.2 espalha onde os novos chunks são *criados*, não para onde as escritas *vão*. E o motivo de as pessoas continuarem escolhendo essa chave é que ela é de fato a melhor escolha para um único `mongod` (inserts ascendentes acrescentam na ponta quente do índice e mantêm o working set minúsculo), então a atração é real, não ignorância. A regra do livro é inequívoca: a menos que você esteja deliberadamente rodando a estratégia firehose em um shard superdimensionado, "não use uma chave ascendente como shard key."
- **O hash corrige o hotspot destruindo a localidade das consultas por intervalo, e essa troca não pode ser feita pela metade.** "Você nunca consegue fazer uma consulta por intervalo direcionada com uma shard key hashed": percorra a animação acima e veja por quê. Dois nomes de usuário alfabeticamente adjacentes caem em chunks diferentes em shards diferentes, então `{username: {$gte: "a", $lt: "c"}}` vira um scatter-gather pelo cluster. O `mongos` precisa fazer broadcast, todos os shards leem e os resultados são combinados. Consultas pontuais sobrevivem (faça o hash do valor, roteie para um shard), mas intervalos, paginação ordenada pela shard key e "me dê tudo da última terça-feira" não. O segundo custo é mais discreto, e o livro o nomeia na seção de chaves aleatórias: acesso aleatório derrota o cache, e "o MongoDB não é eficiente em acessar aleatoriamente dados além do tamanho da RAM." Então o hash troca throughput de escrita e crescimento uniforme por localidade de leitura e tamanho do working set. Escolha-o quando suas leituras forem predominantemente buscas de documento único pela shard key; escolha contra quando uma parte relevante das leituras for por intervalo, e, se a resposta for "as duas coisas", shard keys hashed compostas (4.4+) permitem limitar o hash a um prefixo particionado por intervalo em vez da chave inteira.
- **A decisão tem um custo em forma de migração, o que muda o *processo* mesmo agora que ela é reversível.** O "você não pode mudar sua shard key" do livro agora é falso no sentido estrito (`refineCollectionShardKey` no 4.4 acrescenta campos de sufixo, `reshardCollection` no 5.0 reescreve para uma chave totalmente nova, e o 8.0 deixou os dois mais rápidos), mas fazer resharding de uma coleção em produção reescreve todos os documentos em uma nova distribuição, pede folga de capacidade para uma segunda cópia enquanto roda e é agendado como um projeto de operações. Compare com a alternativa que ele substituiu (dump, drop, re-shard, restore, com downtime) e é uma melhoria enorme; compare com um `ALTER TABLE` e não está na mesma categoria. A consequência prática é de processo, não de código: o momento barato de acertar é *antes* de a coleção ter dados, quando o conselho do livro ("teste em um dataset de backup com tráfego de amostra", porque "nada substitui testar com os seus próprios dados") custa um dia em vez de um trimestre. Esta está entre as decisões iniciais mais consequentes de uma implantação shardeada justamente porque tudo o que vem depois (quais consultas são direcionadas, quais são broadcast, como o working set se comporta, se você consegue zonear por residência) deriva dela.
- **A cardinalidade é um teto rígido para até onde uma coleção pode ser dividida, e ele fica invisível até você precisar do próximo shard.** Uma shard key `"logLevel"` com três valores gera no máximo três chunks ("o MongoDB não conseguiria dividir seus dados em mais de três chunks"), não importa quantos shards você adicione ou quanto a coleção cresça. Nada dá erro; o cluster simplesmente deixa de conseguir rebalancear, e um chunk cresce até virar um jumbo chunk que o balancer se recusa a mover. O hash não ajuda, porque o hash de três valores são três valores. A correção (compor o campo de baixa cardinalidade com algo que varie, `{logLevel: 1, timestamp: 1}`) funciona, e agora pode ser aplicada no lugar via `refineCollectionShardKey`, mas note que ela converte a chave na forma multi-hotspot, com todo o ajuste fino desse padrão junto: poucos prefixos distintos e shards novos não recebem escritas, prefixos demais e você tem escritas aleatórias com passos extras.
- **Zonas dão controle de posicionamento e tiram do balancer a capacidade de ajudar você.** Fixar uma coleção em uma zona é a única resposta real para residência de dados (GDPR) e para hardware heterogêneo, e a API é estável e agradável. Mas toda regra de zona é uma restrição que o balancer precisa satisfazer, e restrições se combinam mal: fixe de `MinKey` a `MaxKey` de uma coleção em uma zona e o crescimento dessa coleção passa a ser limitado pela capacidade dessa zona, sem alívio automático. Esvazie uma zona por acidente e os dados ficam imóveis em vez de redistribuídos: "o balancer não vai distribuir os dados para lugar nenhum, porque não há locais válidos listados. Todos os dados continuam legíveis e graváveis; só não vão conseguir migrar." A estratégia firehose herda a pior versão disso: o intervalo fixado vai "de agora até o infinito", então um cron job avançando a fixação não é um extra desejável, é infraestrutura essencial, e se ele parar, todo chunk que você escrever fica preso em um shard.
- **`moveChunk` manual é a opção que parece controle e normalmente é trabalho que se apaga sozinho.** Desligar o balancer e posicionar chunks à mão é possível, documentado e quase sempre errado: "a menos que você esteja em uma situação excepcional, deveria usar o sharding automático do MongoDB." A falha não é sutil: deixe o balancer rodando e "se o balancer detectar um número desigual de chunks, ele simplesmente vai reembaralhar todo o seu trabalho"; desligue-o e você aceitou a responsabilidade permanente de rebalancear um sistema cuja distribuição de dados muda a cada segundo. E isso não degrada com elegância à medida que o cluster cresce, e é por isso que o livro delimita a seção inteira: "à medida que seu cluster fica maior ou mais movimentado, essas soluções se tornam menos práticas." Se você quer uma distribuição desigual, expresse-a declarativamente com zonas, para que o balancer imponha sua intenção em vez de brigar com ela.
- **Shardear por latência e shardear por throughput pedem chaves diferentes, e você precisa escolher qual dos dois está comprando.** As quatro perguntas iniciais não são um checklist, são uma desambiguação. Menor latência de escrita aponta para chaves baseadas em localização e zonas (colocar os dados perto do usuário ou na máquina mais rápida), o que por construção produz distribuição desigual. Maior throughput de escrita aponta para chaves hashed ou aleatórias, que por construção produzem distribuição uniforme e destroem a localidade. Um working set pequeno aponta para chaves ascendentes, que produzem o hotspot. Não existe chave que vença os três, e o padrão multi-hotspot é a melhor tentativa de meio-termo do livro (uniforme no cluster, ascendente no shard), ao preço de ser o mais difícil de ajustar: o prefixo de baixa cardinalidade precisa ser dimensionado contra a quantidade atual *e* futura de shards, e os dois modos de falha (poucos hotspots, hotspots demais) são silenciosos.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil e Kristina Chodorow, "MongoDB: The Definitive Guide", 3ª edição (O'Reilly, 2020): Capítulo 16, "Choosing a Shard Key", p. 340-359](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/): doc
- [MongoDB Documentation: Choose a Shard Key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/): doc
- [MongoDB Documentation: Hashed Sharding](https://www.mongodb.com/docs/manual/core/hashed-sharding/): doc
- [MongoDB Documentation: Ranged Sharding](https://www.mongodb.com/docs/manual/core/ranged-sharding/): doc
- [MongoDB Documentation: Shard Keys (cardinality, frequency, monotonicity)](https://www.mongodb.com/docs/manual/core/sharding-shard-key/): doc
- [MongoDB Documentation: Reshard a Collection (reshardCollection)](https://www.mongodb.com/docs/manual/core/sharding-reshard-a-collection/): doc
- [MongoDB Documentation: Refine a Shard Key (refineCollectionShardKey)](https://www.mongodb.com/docs/manual/core/sharding-refine-a-shard-key/): doc
- [MongoDB Documentation: Zones and Zone Sharding](https://www.mongodb.com/docs/manual/core/zone-sharding/): doc
- [MongoDB Documentation: Sharded Cluster Balancer](https://www.mongodb.com/docs/manual/core/sharding-balancer-administration/): doc
- [MongoDB Documentation: Data Partitioning with Chunks](https://www.mongodb.com/docs/manual/core/sharding-data-partitioning/): doc
- [MongoDB Documentation: Hashed Indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-hashed/): doc
- [MongoDB Documentation: Shard a GridFS Data Store](https://www.mongodb.com/docs/manual/tutorial/shard-gridfs-data/): doc
