---
title: "Compromissos de consistência no projeto de sistemas de banco de dados distribuídos modernos: o CAP é apenas parte da história"
summary: Abadi argumenta, em um artigo de opinião e síntese de seis páginas, que o CAP restringe um banco de dados distribuído apenas enquanto dura uma partição de rede, e que o compromisso entre consistência e latência, presente na operação normal, explica mais dos projetos de consistência reduzida dos anos 2000. Ele propõe o PACELC para enunciar as duas escolhas de uma vez e posiciona Dynamo, Cassandra, Riak, PNUTS, MongoDB, HBase, VoltDB/H-Store e Megastore em seus quadrantes.
researchArea: Sistemas distribuídos
keywords: PACELC, teorema CAP, compromisso consistência-latência, replicação de dados, partições de rede, replicação por quórum, sistemas de banco de dados distribuídos, PNUTS
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O impacto do teorema CAP no projeto de sistemas de banco de dados distribuídos modernos é mais limitado do que se costuma perceber. Outro compromisso, entre consistência e latência, teve influência mais direta sobre vários DDBSs conhecidos. Uma nova formulação proposta, o PACELC, unifica esse compromisso com o CAP.

## Visão geral

Daniel J. Abadi (Universidade de Yale) publicou este texto na IEEE Computer, volume 45, número 2, em fevereiro de 2012, páginas 37 a 42, como artigo de capa. É um texto curto para profissionais, não um artigo de pesquisa: não traz experimentos próprios e se apoia em dois estudos de outros autores. O cenário é a década seguinte à prova da [conjectura de Brewer](/papers/brewers-conjecture-cap-feasibility-web-services), quando sistemas como o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e o [Cassandra](/papers/cassandra-decentralized-structured-storage-system) abriam mão da consistência por padrão e o CAP era a explicação habitual.

Abadi diz que a explicação está errada ou, no mínimo, incompleta. A consistência de que ele trata é a atômica, ou linearizável, usada por Gilbert e Lynch na prova (veja [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects)). Entradas relacionadas do catálogo: [Eventually Consistent](/papers/eventually-consistent-vogels), pelos parâmetros N, W e R de quórum em que o artigo se apoia, e o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), que o artigo lista junto com o HBase.

Vale saber antes: o que é uma partição de rede, o significado de consistência, disponibilidade e tolerância a partições no CAP, e leituras e escritas por quórum com R + W > N.

## Contribuição

- **Uma leitura do CAP.** O CAP impõe limitações apenas diante de certos tipos de falha. Não é a tolerância a partições sozinha, e sim ela combinada com uma partição real que força a escolha entre disponibilidade e consistência. No caso-base, o CAP permite o conjunto completo de garantias ACID junto com alta disponibilidade.
- **Um segundo compromisso, sempre presente.** Todo sistema que replica dados (o que a alta disponibilidade exige) precisa trocar consistência por latência, com ou sem partições. O artigo trata disponibilidade e latência como, em boa medida, a mesma coisa: um sistema indisponível tem, na prática, latência extremamente alta.
- **PACELC.** Se há partição (P), como o sistema troca disponibilidade por consistência (A e C); senão (E), na operação normal sem partições, como troca latência por consistência (L e C).
- **Uma classificação.** O artigo rotula sistemas conhecidos com o código de quatro letras e argumenta, a partir do PNUTS, que a escolha de reduzir consistência no caso-base não se deve ao CAP.

## Metodologia

Não há medição. O método é um argumento por enumeração. O artigo primeiro lista os contextos em que os sistemas foram construídos (o carrinho de compras da Amazon para o Dynamo, a busca na caixa de entrada do Facebook para o Cassandra, os recursos com muita escrita do LinkedIn para o Voldemort, os dados de cada visualização de página do Yahoo para o PNUTS, usos parecidos com os da Amazon para o Riak) e cita um estudo do Google segundo o qual 100 ms a mais podem reduzir drasticamente a probabilidade de o cliente continuar interagindo ou voltar. Depois afirma que há só três jeitos de replicar: enviar as atualizações a todas as réplicas ao mesmo tempo, a um nó mestre combinado primeiro, ou a um nó arbitrário primeiro. Cada um é cruzado com replicação síncrona, assíncrona ou mista e com o ponto onde as leituras são servidas, e para cada combinação o artigo nomeia o custo de latência ou a perda de consistência. Dois estudos externos, sobre o Cassandra e sobre o SimpleDB, servem de evidência. Os sistemas são então colocados no PACELC a partir do projeto padrão, e o artigo diz que seu foco é o projeto original, não os ajustes que se tornaram possíveis depois das primeiras versões.

## Resultados

- **Por que consistência custa latência.** Enviar a todas as réplicas ao mesmo tempo exige um protocolo de acordo ou uma camada de pré-processamento para evitar divergência, e ambos somam latência. Um nó mestre com replicação síncrona espera pela réplica mais lenta, principalmente numa WAN. Com replicação assíncrona, ler só do mestre mantém a consistência, mas perde a réplica próxima e o balanceamento de carga, enquanto ler de qualquer nó é rápido, mas pode devolver versões diferentes. Enviar a atualização a um nó arbitrário primeiro soma o custo de resolver atualizações simultâneas do mesmo item. Com quórum, R + W > N mantém a consistência e R + W <= N permite leituras inconsistentes.
- **Evidência de terceiros.** Rao, Shekita e Tata constataram no Cassandra que leituras por quórum e leituras fracas podem diferir em latência por um fator de quatro ou mais. Wada e colegas não encontraram aumento significativo de latência nas leituras consistentes do SimpleDB, mas só dentro de uma região, e o artigo suspeita de replicação mestre-escravo a curta distância.
- **O PNUTS como caso mais claro.** Ele atribui um mestre a cada item, replica de forma assíncrona numa WAN e serve leituras de qualquer réplica, ou seja, a opção (2)(b)(ii). Numa partição que isola o mestre, o padrão é tornar o item indisponível para atualizações, então por padrão ele é CP.
- **Posição no PACELC.**

| Sistema | Classe |
|---|---|
| Dynamo, Cassandra, Riak | PA/EL |
| VoltDB/H-Store, Megastore | PC/EC |
| BigTable, HBase | PC/EC |
| MongoDB | PA/EC |
| PNUTS | PC/EL |

Dynamo, Cassandra e Riak usam uma combinação das opções (2)(c) e (3) e, segundo o artigo, passam mais plenamente à (3) durante uma partição, com código de reconciliação. Voldemort e SimpleDB são discutidos, mas não recebem classe na seção do PACELC. PC/EL não significa totalmente consistente: PC quer dizer que o sistema não reduz a consistência além do nível-base durante uma partição.

## Análise crítica

- **Opinião, não evidência.** O artigo não apresenta medição própria. Seu principal apoio empírico são dois estudos de terceiros, que segundo ele parecem se contradizer até que se considere o cenário do SimpleDB. Que o compromisso consistência/latência seja discutivelmente mais influente que o CAP é a leitura do autor, assim como a ideia de que sistemas no estilo Dynamo reaproveitaram o código de tratamento de partições para a escolha do caso-base.
- **A classificação é interpretação.** Os rótulos vêm da configuração padrão da época, e o texto observa que a consistência de alguns sistemas se tornou ajustável depois das primeiras versões. Não verifiquei como esses produtos se comportam hoje, então a tabela deve ser lida como retrato de 2012. O próprio artigo chama o PC/EL de confuso e classifica o MongoDB como PA/EC ao notar que, tecnicamente, ele não é disponível pela definição do CAP.
- **O que não é afirmado.** O artigo não diz que o CAP está errado, que partições nunca importam, nem que a latência é o único motivo para relaxar a consistência. Também não dá números para o custo ou a frequência das partições, só diz que são "um tanto raras" e muitas vezes menos frequentes que outras falhas, citando um post de blog.
- **Sistemas posteriores no catálogo (comparação feita aqui, não no artigo).** [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) (2013) mede a diferença de latência entre projetos sem coordenação e com coordenação, e o [COPS](/papers/dont-settle-for-eventual-scalable-causal-consistency-cops) (2011) busca consistência causal com baixa latência. O [Spanner](/papers/spanner-globally-distributed-database) (2012) surgiu depois deste artigo e não é classificado nele.

Literatura posterior, que não faz parte do artigo. O texto de Brewer "CAP twelve years later: How the rules have changed" aparece no Crossref na mesma edição da Computer (volume 45, número 2, páginas 23 a 29, DOI 10.1109/mc.2012.37). Li apenas esses metadados, não o texto, e não sei o que ele diz sobre o PACELC.

## Pesquisas futuras

- Medir o compromisso consistência/latência entre regiões para o mesmo sistema e a mesma carga, o que o artigo só defende a partir de dois estudos.
- Quantificar quão raras são as partições em diferentes implantações, já que a premissa do artigo se apoia numa afirmação geral.
- Classificar os sistemas pelas opções de configuração atuais, não só pelo projeto original.
- Relacionar o PACELC a modelos de consistência mais fracos que dispensam coordenação síncrona, como a consistência causal.
