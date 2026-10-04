---
version: 1.0
updatedAt: 2026-09-06
title: "Endereçamento IPv4 e CIDR"
summary: "Um endereço de 32 bits dividido num prefixo de rede e num sufixo de host, com a notação CIDR (ex.: 128.11.3.0/24) substituindo o antigo esquema rígido baseado em classes por um prefixo de tamanho arbitrário. A aritmética de sub-redes trabalhada mostra exatamente quantos endereços de host utilizáveis um dado tamanho de prefixo deixa, e por que o espaço de endereços precisou ser racionado com tanto cuidado antes do IPv6."
---
## Objetivos de Aprendizagem

- Descrever a estrutura de um endereço IPv4: um número de 32 bits, escrito em notação decimal com pontos, dividido num prefixo de rede e num sufixo de host.
- Explicar a notação CIDR e ler corretamente um par real de endereço/tamanho de prefixo (ex.: `128.11.3.0/24`).
- Calcular o número de endereços de host utilizáveis disponíveis sob um dado tamanho de prefixo.
- Explicar por que o CIDR substituiu o esquema de endereçamento mais antigo e rígido, baseado em classes (Classe A/B/C), e que problema específico ele resolveu.
- Realizar um cálculo básico de sub-redes: dividir um bloco de endereços em sub-redes menores de um tamanho especificado.

## Contexto e Motivação

Tendo estabelecido, no conceito anterior, que o encaminhamento e o endereçamento são preocupações do plano de dados, este conceito cobre a estrutura concreta dos endereços sobre os quais o plano de dados de fato encaminha: os endereços IPv4, e o CIDR, a notação e o esquema de alocação que governam o endereçamento IPv4 desde o início dos anos 1990. Este é um material genuinamente prático e computacional (a aritmética de sub-redes é uma tarefa real e cotidiana para qualquer pessoa que configure infraestrutura de rede), e ele prepara o próximo conceito, o encaminhamento de datagramas via correspondência do prefixo mais longo, que depende diretamente de entender como o tamanho do prefixo de um endereço determina quais entradas da tabela de encaminhamento podem casar com ele.

## Teoria Central

### A estrutura do endereço IPv4

Um endereço IPv4 é um número de 32 bits, convencionalmente escrito em notação decimal com pontos como quatro números de 8 bits (cada um indo de 0 a 255) separados por pontos; por exemplo, `192.168.1.10`. Conceitualmente, um endereço é dividido em duas partes: um prefixo de rede (identificando a qual rede o endereço pertence) e um sufixo de host (identificando um host específico dentro dessa rede). Onde exatamente a divisão entre prefixo e sufixo cai não é fixo globalmente: ela varia de bloco de endereços para bloco de endereços, que é precisamente o que a notação CIDR existe para especificar explicitamente.

### A notação CIDR

A notação Classless Inter-Domain Routing (CIDR) escreve um bloco de endereços como `endereço/tamanho-do-prefixo`; por exemplo, `128.11.3.0/24` significa que os primeiros 24 bits do endereço são o prefixo de rede fixo, e os 8 bits restantes (32 − 24) ficam disponíveis para os endereços de host dentro dessa rede. Um bloco `/24` tem, portanto, `2^8 = 256` valores possíveis no total na sua porção de host; um bloco `/16` tem `2^16 = 65.536` valores possíveis no total; um bloco `/30` tem `2^2 = 4` valores possíveis no total. Quanto menor o tamanho do prefixo, mais bits sobram para os hosts, e maior o bloco.

### Do endereçamento baseado em classes ao CIDR

O endereçamento IPv4 originalmente usava um esquema rígido baseado em classes: as redes Classe A usavam um prefixo fixo de 8 bits (permitindo 16 milhões de endereços de host por rede, geralmente muito mais do que qualquer organização real precisava), a Classe B usava um prefixo fixo de 16 bits (65.536 hosts, frequentemente ainda muito mais do que o necessário, ou às vezes insuficiente), e a Classe C usava um prefixo fixo de 24 bits (256 hosts, frequentemente pouco demais). Essa rigidez era um problema real e sério: uma organização que precisasse de 1.000 endereços não tinha um tamanho que servisse bem: um bloco Classe C (256) era pequeno demais, forçando-a a pedir um bloco Classe B (65.536), desperdiçando os aproximadamente 64.000 outros endereços que esse bloco poderia ter servido em outro lugar. O CIDR substituiu isso por um tamanho de prefixo arbitrário, permitindo que um bloco de endereços fosse dimensionado para casar genuinamente com a necessidade real de uma organização (um bloco `/22`, por exemplo, fornece exatamente 1.024 endereços), aliviando diretamente o esgotamento do espaço de endereços que esse esquema de alocação rígido e desperdiçador estava acelerando.

### Endereços de host utilizáveis

Dentro de um dado prefixo, nem todo endereço fica disponível para um host de fato: por convenção, o primeiro endereço de um bloco (todos os bits de host zero) identifica a própria rede, e o último endereço (todos os bits de host um) é reservado como endereço de broadcast daquela rede. Os dois são excluídos do conjunto de endereços que podem de fato ser atribuídos a um host. Um bloco `/24`, com `2^8 = 256` endereços no total, tem portanto `256 - 2 = 254` endereços de host utilizáveis.

## Exemplos Resolvidos

### Exemplo 1: Lendo um bloco CIDR

`128.11.3.0/24` significa:

```text
Prefixo de rede fixo: os primeiros 24 bits, correspondendo a 128.11.3
Porção de host variável: os 8 bits restantes (32 - 24 = 8)

Total de endereços neste bloco:  2^8 = 256
Endereços de host utilizáveis:   256 - 2 = 254
  (excluindo 128.11.3.0 como o endereço de rede e
   128.11.3.255 como o endereço de broadcast)
Faixa de endereços:              de 128.11.3.0 até 128.11.3.255
```

### Exemplo 2: Calculando os hosts utilizáveis para vários tamanhos de prefixo

```text
Prefixo    Bits de host   Total de endereços (2^bits)   Hosts utilizáveis (total - 2)
/30        2              4                              2
/28        4              16                             14
/24        8              256                            254
/22        10             1.024                          1.022
/16        16             65.536                         65.534
```

Uma organização que genuinamente precisa de cerca de 1.000 endereços de host é mais bem atendida por um bloco `/22` (1.022 endereços utilizáveis). Sob o antigo esquema baseado em classes, o encaixe mais próximo acima dos 254 endereços de uma Classe C teria sido uma Classe B completa, com 65.534, desperdiçando bem mais de 98% do espaço de endereços desse bloco.

### Exemplo 3: Dividindo um bloco `/24` em quatro sub-redes menores

Uma organização recebe `10.0.1.0/24` (254 endereços utilizáveis) e precisa dividi-lo em 4 sub-redes de tamanho igual, uma por departamento.

```text
Dividir um /24 em 4 pedaços iguais significa tomar emprestados 2 bits
adicionais para as sub-redes (já que 2^2 = 4), produzindo quatro sub-redes /26:

10.0.1.0/26     (endereços de 10.0.1.0   a 10.0.1.63,   62 hosts utilizáveis)
10.0.1.64/26    (endereços de 10.0.1.64  a 10.0.1.127,  62 hosts utilizáveis)
10.0.1.128/26   (endereços de 10.0.1.128 a 10.0.1.191,  62 hosts utilizáveis)
10.0.1.192/26   (endereços de 10.0.1.192 a 10.0.1.255,  62 hosts utilizáveis)
```

Cada sub-rede `/26` tem `2^(32-26) = 2^6 = 64` endereços no total, menos 2 (rede e broadcast) = 62 endereços de host utilizáveis por departamento: um cálculo de sub-redes real e trabalhado, exatamente do tipo realizado ao configurar infraestrutura de rede real.

## Equívocos Comuns e Armadilhas

- **"Um número de prefixo menor significa um bloco de endereços menor."** É o oposto: um tamanho de prefixo menor (ex.: `/16`) deixa mais bits para a porção de host e, portanto, descreve um bloco *maior*; um tamanho de prefixo maior (ex.: `/28`) deixa menos bits de host e descreve um bloco *menor*.
- **"Todo endereço de um bloco CIDR pode ser atribuído a um host."** Dois endereços de todo bloco são reservados por convenção (a porção de host toda em zeros, o próprio endereço de rede, e a porção de host toda em uns, o endereço de broadcast), deixando `2^(bits de host) - 2` endereços de fato utilizáveis para hosts.
- **"O endereçamento baseado em classes e o CIDR descrevem a mesma coisa com nomes diferentes."** O endereçamento baseado em classes fixava o tamanho do prefixo em um de exatamente três valores (8, 16 ou 24 bits), independentemente da necessidade real de uma organização; o CIDR permite qualquer tamanho de prefixo, deixando o tamanho de um bloco casar com precisão com os requisitos reais: uma diferença genuína, e não meramente cosmética, de flexibilidade.
- **"A divisão em sub-redes só divide um bloco em pedaços de tamanho igual."** A divisão em sub-redes de tamanho igual (como no Exemplo 3) é o caso mais simples; a divisão real em sub-redes também pode alocar sub-redes de tamanhos diferentes a partir do mesmo bloco pai (máscaras de sub-rede de tamanho variável), um cálculo mais flexível, porém mais envolvente, não desenvolvido mais neste conceito introdutório.

## Resumo

Um endereço IPv4 é um número de 32 bits dividido num prefixo de rede e num sufixo de host, com a notação CIDR (`endereço/tamanho-do-prefixo`) especificando exatamente onde essa divisão cai para um dado bloco: um bloco `/24` tem 256 endereços no total (254 utilizáveis, depois de excluir os endereços de rede e de broadcast), e tamanhos de prefixo menores descrevem blocos maiores. O CIDR substituiu o esquema anterior e rígido baseado em classes (só prefixos fixos de 8, 16 ou 24 bits) especificamente para deixar os tamanhos dos blocos de endereços casarem com a necessidade organizacional real, aliviando diretamente o enorme desperdício de endereços que o mau encaixe do esquema antigo produzia. A divisão em sub-redes (dividir um bloco em pedaços menores tomando emprestados bits adicionais de prefixo) é um cálculo real e cotidiano que este conceito percorre concretamente. O próximo conceito, o encaminhamento de datagramas via correspondência do prefixo mais longo, depende diretamente desta estrutura de tamanho de prefixo: ela é precisamente o que permite que uma entrada de tabela de encaminhamento de prefixo curto cubra muitos endereços, enquanto uma entrada mais específica, de prefixo mais longo, ainda tem precedência quando se aplica.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão do endereçamento IPv4, do CIDR e da divisão em sub-redes.
- [Stanford CS144: Lecture Schedule ("IP and Forwarding")](https://www.scs.stanford.edu/10au-cs144/sched/): uma aula de um curso real que cobre o endereçamento IP diretamente antes da mecânica de encaminhamento.
