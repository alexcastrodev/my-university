---
version: 1.0
updatedAt: 2026-09-06
title: "Encaminhamento de Datagramas e Correspondência de Prefixo Mais Longo"
summary: "Um roteador encaminha um pacote encontrando, entre todos os prefixos em sua tabela, o mais longo que corresponde ao endereço de destino, trabalhado à mão contra uma pequena tabela de encaminhamento concreta: a regra que permite que uma entrada cubra milhões de endereços enquanto uma entrada mais específica ainda tem precedência quando se aplica."
---
## Objetivos de Aprendizagem

- Enunciar a regra de correspondência de prefixo mais longo e explicar qual problema ela resolve quando uma tabela de encaminhamento tem múltiplas entradas correspondentes para um endereço.
- Realizar uma busca por correspondência de prefixo mais longo à mão contra uma tabela de encaminhamento pequena e concreta.
- Explicar por que a correspondência de prefixo mais longo, em vez da correspondência exata, é necessária, dado que blocos CIDR de tamanhos diferentes podem se sobrepor.
- Conectar o requisito de velocidade da correspondência de prefixo mais longo de volta à distinção plano de dados/plano de controle: por que esta busca específica precisa ser extremamente rápida.
- Explicar o que acontece quando nenhuma entrada na tabela de encaminhamento corresponde a um endereço de forma alguma (a rota padrão).

## Contexto e Motivação

O conceito anterior estabeleceu os prefixos de endereço de comprimento variável do CIDR; este conceito cobre o algoritmo de fato que um roteador executa, para cada pacote que chega, para decidir em qual enlace de saída encaminhá-lo: a correspondência de prefixo mais longo. Esta é a mecânica concreta de plano de dados para a qual a distinção plano de dados vs. plano de controle, coberta dois conceitos atrás, vinha construindo: a busca específica, que precisa ser extremamente rápida, que um roteador realiza milhões de vezes por segundo, usando qualquer tabela de encaminhamento que o plano de controle (muito mais lento) já tenha computado e instalado.

## Teoria Central

### Por que a correspondência exata não é suficiente

Uma entrada de tabela de encaminhamento não é um único endereço, é um prefixo CIDR, cobrindo potencialmente milhões de endereços de uma vez (uma entrada `/8`, por exemplo, cobre mais de 16 milhões de endereços individuais). Este é precisamente o ponto do CIDR: uma entrada pode resumir informação de roteamento para uma faixa enorme de endereços, mantendo as tabelas de encaminhamento muito menores do que seriam se cada endereço de host individual precisasse de sua própria entrada. Mas isso cria uma complicação real: como prefixos de comprimentos diferentes podem genuinamente se sobrepor (uma entrada `/8` e uma entrada `/24` mais específica, ambas cobrindo o mesmo endereço de destino, podem ambas existir legitimamente na mesma tabela simultaneamente, se aquele subconjunto `/24` precisa ser roteado de forma diferente do resto do `/8` que o contém), um roteador não pode simplesmente encontrar "uma" entrada que corresponde a um endereço, ele precisa encontrar a *certa*.

### A regra de correspondência de prefixo mais longo

Quando múltiplas entradas em uma tabela de encaminhamento correspondem a um dado endereço de destino (múltiplos prefixos, de comprimentos diferentes, todos contendo aquele endereço), o roteador seleciona a entrada com o prefixo correspondente mais longo, a correspondência mais específica, não meramente a primeira encontrada ou uma arbitrária entre as correspondências. Esta regra existe precisamente porque um prefixo mais longo e mais específico representa informação de roteamento mais detalhada e mais autoritativa sobre aquela subfaixa particular de endereços do que um prefixo mais curto e mais geral cobrindo uma faixa muito maior que por acaso também o contém.

### Requisitos de velocidade

Como esta busca acontece para cada pacote que um roteador encaminha, potencialmente milhões de vezes por segundo em um roteador movimentado, ela precisa ser implementada de forma extremamente eficiente. Roteadores reais usam estruturas de dados especializadas e frequentemente hardware dedicado (em vez de uma varredura linear ingênua por cada entrada da tabela) para realizar a correspondência de prefixo mais longo nos poucos nanossegundos que a taxa de transmissão de um enlace moderno exige; os detalhes algorítmicos e de hardware de exatamente como isso é alcançado nessa velocidade estão além do escopo deste conceito, mas o *requisito*, de que esta busca específica fica exatamente no plano de dados e precisa ser extremamente rápida, é precisamente a propriedade que a distinção plano de dados/plano de controle, coberta anteriormente neste agrupamento, existe para proteger.

### A rota padrão

Se nenhuma entrada na tabela de encaminhamento corresponde a um endereço de destino de forma alguma, nem mesmo o prefixo mais curto e mais geral, o roteador usa uma rota padrão: tipicamente uma entrada `0.0.0.0/0` (um prefixo de comprimento zero, correspondendo a todo endereço possível) apontando para um único enlace de saída geral do tipo "todo o resto vai aqui", mais comumente em direção a um provedor upstream que tem conhecimento mais amplo de como alcançar a Internet mais ampla. A rota padrão é, tecnicamente, apenas o prefixo mais curto possível, comprimento zero, então ela participa da mesma regra de correspondência de prefixo mais longo que toda outra entrada, simplesmente perdendo para qualquer correspondência mais específica sempre que uma existir.

## Exemplos Resolvidos

### Exemplo 1: Correspondência de prefixo mais longo contra uma pequena tabela de encaminhamento

A tabela de encaminhamento de um roteador contém:

```text
Prefixo             Enlace de saída
128.11.0.0/16        Enlace A
128.11.3.0/24        Enlace B
0.0.0.0/0            Enlace C (rota padrão)
```

Um pacote chega destinado a `128.11.3.5`. Verifique cada entrada:

```text
128.11.0.0/16: corresponde (128.11.3.5 cai dentro de 128.11.0.0-128.11.255.255)
128.11.3.0/24: corresponde (128.11.3.5 cai dentro de 128.11.3.0-128.11.3.255)
0.0.0.0/0:     corresponde (corresponde a tudo)
```

Todas as três entradas tecnicamente correspondem, mas a regra de correspondência de prefixo mais longo seleciona `128.11.3.0/24` (um prefixo de 24 bits, o mais longo entre as correspondências), então o pacote é encaminhado via Enlace B, mesmo que a entrada `/16` mais curta e a rota padrão também cubram tecnicamente este endereço.

### Exemplo 2: Um pacote que corresponde apenas à rota padrão

Usando a mesma tabela, um pacote chega destinado a `203.0.113.7`:

```text
128.11.0.0/16: NÃO corresponde (203.0.113.7 está fora desta faixa)
128.11.3.0/24: NÃO corresponde (mesma razão)
0.0.0.0/0:     corresponde (corresponde a tudo, por definição)
```

Apenas a rota padrão corresponde, então o pacote é encaminhado via Enlace C: o roteador não tem informação mais específica sobre a rede de destino de `203.0.113.7`, então ele encaminha em direção ao caminho de propósito geral "todo o resto", que tipicamente leva a um provedor upstream mais bem posicionado para roteá-lo adiante.

### Exemplo 3: Por que uma entrada mais específica pode coexistir legitimamente com uma mais ampla

Suponha que uma organização possui o bloco inteiro `128.11.0.0/16` (roteado geralmente via Enlace A), mas recentemente moveu um subconjunto `/24` específico desse bloco, `128.11.3.0/24`, para um local físico diferente, agora alcançável apenas via Enlace B. Em vez de reconfigurar a entrada `/16` inteira (o que rotearia erroneamente todo outro endereço nesse bloco, ainda corretamente alcançável via Enlace A), o roteador simplesmente adiciona a entrada `128.11.3.0/24` mais específica ao lado da entrada `/16` existente. A correspondência de prefixo mais longo então envia automaticamente o tráfego para o subconjunto movido via Enlace B enquanto todo o resto no bloco `/16` continua, corretamente, via Enlace A, uma razão real e prática pela qual prefixos sobrepostos de comprimentos diferentes coexistem em tabelas de encaminhamento reais, e exatamente por que "a correspondência mais específica vence" é a regra necessária em vez de uma convenção arbitrária.

## Equívocos Comuns e Armadilhas

- **"Uma tabela de encaminhamento só tem uma entrada que corresponde a qualquer dado endereço."** Múltiplas entradas, com prefixos de comprimentos diferentes, podem legitimamente corresponder ao mesmo endereço simultaneamente: esta é uma situação normal e esperada (o Exemplo 3 mostra exatamente por quê), não um erro de configuração de tabela, e é precisamente o que a regra de correspondência de prefixo mais longo existe para resolver corretamente.
- **"A rota padrão é um caso especial tratado separadamente da correspondência de prefixo mais longo."** Ela não é tratada como caso especial: é simplesmente o prefixo mais curto possível (comprimento zero), participando da mesma regra de correspondência de prefixo mais longo que toda outra entrada; ela só "vence" quando nada mais específico corresponde.
- **"Prefixos mais longos são de alguma forma mais lentos de corresponder."** As implementações de roteadores reais são construídas especificamente para que encontrar o prefixo correspondente mais longo, entre potencialmente muitas correspondências, não seja significativamente mais lento do que encontrar qualquer correspondência única: o requisito de velocidade se aplica igualmente independentemente de qual comprimento de prefixo em última análise vença.
- **"Um roteador escolhe a primeira entrada correspondente que por acaso verifica, na ordem da tabela."** A regra é definida pelo comprimento do prefixo (a mais específica vence), não pela ordem em que as entradas por acaso são armazenadas ou verificadas: uma implementação correta precisa encontrar a correspondência mais longa entre *todas* as entradas correspondentes, não meramente a primeira encontrada.

## Resumo

Como prefixos CIDR de comprimentos diferentes podem se sobrepor legitimamente, uma entrada ampla e geral e uma entrada mais estreita e mais específica ambas cobrindo o mesmo endereço, um roteador não pode simplesmente encontrar qualquer entrada de tabela de encaminhamento correspondente; ele precisa aplicar a regra de correspondência de prefixo mais longo, selecionando o prefixo correspondente mais específico (mais longo) entre cada entrada que corresponde. Esta busca acontece para cada pacote que um roteador encaminha e precisa, portanto, ser extremamente rápida, a instanciação concreta do requisito de velocidade de plano de dados estabelecido dois conceitos atrás. Quando nenhuma entrada corresponde de forma alguma, a rota padrão (prefixo de comprimento zero, correspondendo a tudo) fornece um recurso de fallback, tipicamente apontando para um provedor upstream, participando da mesma regra de correspondência de prefixo mais longo que toda outra entrada, simplesmente como a correspondência menos específica possível. Este conceito completa a figura de como um único roteador transforma um endereço, estruturado como coberto no conceito anterior, em uma decisão de encaminhamento de fato.

## Documentation Links

- [Stanford CS144 — Lecture Schedule ("IP and Forwarding")](https://www.scs.stanford.edu/10au-cs144/sched/): uma palestra de curso real cobrindo o encaminhamento IP diretamente, imediatamente após o endereçamento.
- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão sobre encaminhamento por correspondência de prefixo mais longo.
