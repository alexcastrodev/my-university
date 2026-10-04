---
version: 1.0
updatedAt: 2026-09-06
title: "ARP e Resolução de Endereços"
summary: "Endereços IP roteiam um pacote através das redes, mas um quadro de camada de enlace precisa do endereço MAC do destino para este único salto: o ARP resolve um no outro transmitindo uma consulta em broadcast e armazenando a resposta em cache, e esse cache é, mecanicamente, exatamente a tabela hash já coberta: endereço IP como chave, endereço MAC como valor, com um timeout real em vez de uma política de remoção."
---
## Objetivos de Aprendizagem

- Explicar o problema que o ARP resolve: saber o endereço IP de um destino não é suficiente para construir um quadro de camada de enlace para o próximo salto.
- Traçar uma troca de requisição e resposta ARP passo a passo, incluindo a natureza de broadcast da requisição.
- Explicar o cache ARP como, mecanicamente, exatamente a tabela hash já coberta: mesma estrutura, mesmo propósito (busca rápida por chave), um timeout real em vez de uma política de remoção explícita.
- Explicar por que o ARP tem escopo de uma única rede local (um domínio de broadcast) e não funciona, por si só, através de roteadores.
- Enunciar o que acontece quando uma busca no cache ARP falha, e como a resposta resultante é armazenada em cache para uso futuro.

## Contexto e Motivação

O conceito anterior estabeleceu que endereços MAC e endereços IP servem a propósitos genuinamente diferentes em camadas diferentes, e que ambos são necessários simultaneamente. Este conceito cobre o mecanismo concreto que faz a ponte entre os dois: um nó que conhece o endereço IP de um destino (da camada de rede, já coberta), mas precisa construir um quadro de camada de enlace para o próximo salto imediato, precisa também do endereço MAC do destino. O ARP (Address Resolution Protocol) é o que o fornece. Este é também um momento genuinamente oportuno para conectar de volta a `data-structures-i`: o cache ARP que torna essa resolução rápida em toda requisição após a primeira não é meramente *parecido* com uma tabela hash, ele é mecanicamente exatamente a tabela hash já coberta, aplicada a um problema de rede real e cotidiano.

## Teoria Central

### O problema: endereços IP roteiam, mas quadros precisam de endereços MAC

Um roteador (ou host) que decide encaminhar um datagrama para um próximo salto específico, usando a informação de roteamento já coberta, conhece o endereço IP desse próximo salto, mas para de fato transmitir um quadro de camada de enlace através do meio físico até alcançar esse próximo salto, o cabeçalho de camada de enlace do quadro precisa do endereço MAC do próximo salto, não de seu endereço IP (dispositivos de camada de enlace ao longo desse único salto, incluindo quaisquer switches, encaminham com base em endereços MAC, não em endereços IP). O ARP é o protocolo que traduz um endereço IP conhecido, para um nó na mesma rede local, em seu endereço MAC correspondente.

### A troca de requisição e resposta ARP

Quando um nó precisa do endereço MAC correspondente a um endereço IP conhecido em sua rede local, e ainda não o tem em cache, ele transmite em broadcast uma requisição ARP para todo nó na rede local: "quem tem este endereço IP? me diga seu endereço MAC." Todo nó na rede local recebe esse broadcast, mas apenas o único nó cujo próprio endereço IP corresponde à requisição responde, com uma resposta ARP unicast diretamente de volta ao requisitante, contendo seu endereço MAC. O nó requisitante então tem o mapeamento de que precisa para construir seu quadro de camada de enlace e, criticamente, armazena esse mapeamento em cache para uso futuro, evitando a necessidade de transmitir em broadcast uma requisição ARP novamente para o mesmo endereço IP tão cedo.

### O cache ARP é uma tabela hash

O cache ARP armazena exatamente o tipo de mapeamento que `hashing-and-hash-functions`, já coberto, é construído para suportar: uma chave (o endereço IP) mapeada para um valor (o endereço MAC correspondente), com busca rápida por chave em tempo constante no caso médio, precisamente a propriedade definidora de uma tabela hash. A única característica genuinamente distintiva que as redes adicionam não é uma estrutura de dados diferente, mas uma política de remoção diferente: em vez de uma estratégia de remoção explícita e escolhida pelo programador (como o rehashing orientado pelo fator de carga já coberto), as entradas do cache ARP simplesmente expiram após um timeout fixo (comumente alguns minutos), sob a teoria de que os mapeamentos IP-para-MAC de uma rede podem genuinamente mudar ao longo do tempo (uma placa de interface de rede pode ser substituída, um dispositivo pode receber um endereço IP diferente) e um mapeamento em cache obsoleto, mantido indefinidamente, acabaria por se tornar incorreto.

### Escopo: apenas uma rede local

O ARP opera inteiramente dentro de uma única rede local, um único domínio de broadcast, onde um broadcast de requisição ARP genuinamente alcança todo nó diretamente. Ele não resolve, por si só, um endereço IP em uma rede diferente alcançável apenas através de um roteador: um nó que precisa alcançar um destino em uma rede diferente resolve, via ARP, apenas o endereço MAC de seu próprio roteador local (o próximo salto para aquele destino, conforme sua própria tabela de encaminhamento, já coberta), não o endereço MAC do destino final em si, que pode estar a muitos saltos e muitas resoluções ARP separadas de distância, uma por salto, cada uma inteiramente local ao próprio domínio de broadcast daquele salto.

## Exemplos Resolvidos

### Exemplo 1: Uma troca completa de requisição e resposta ARP

O host A (IP `192.168.1.10`, MAC `AA:AA:AA:AA:AA:AA`) precisa enviar um quadro ao host B (IP `192.168.1.20`), na mesma rede local, mas não tem o endereço MAC de B em cache.

```text
1. O host A transmite em broadcast uma requisição ARP para toda a rede local:
   "Quem tem 192.168.1.20? Diga a 192.168.1.10 (AA:AA:AA:AA:AA:AA)."

2. Todo nó na rede local recebe este broadcast. Apenas
   o host B, cujo próprio endereço IP corresponde, responde.

3. O host B envia uma resposta ARP unicast diretamente ao host A:
   "192.168.1.20 está em BB:BB:BB:BB:BB:BB."

4. O host A agora tem o mapeamento de que precisa, armazena-o em cache e constrói
   seu quadro de camada de enlace com MAC de destino = BB:BB:BB:BB:BB:BB.
```

Todo outro nó na rede local, além de B, simplesmente ignora a requisição de broadcast, já que o endereço IP requisitado não corresponde ao seu próprio.

### Exemplo 2: O cache ARP como uma tabela hash, explicitamente

```text
Cache ARP (conceitualmente idêntico a uma tabela hash):

Chave (endereço IP)   Valor (endereço MAC)      TTL restante
192.168.1.20          BB:BB:BB:BB:BB:BB          180 segundos
192.168.1.30          CC:CC:CC:CC:CC:CC           45 segundos
192.168.1.1            DD:DD:DD:DD:DD:DD          299 segundos
```

Uma busca por `192.168.1.20` é exatamente uma busca em tabela hash por chave, já coberta: faz o hash do endereço IP, encontra o bucket correspondente, recupera o endereço MAC associado, tudo em tempo constante no caso médio. A única adição genuinamente específica de redes é a coluna TTL: uma vez que o tempo restante de uma entrada chega a zero, ela é removida automaticamente (uma nova requisição ARP é emitida na próxima vez que aquele endereço IP precisar ser resolvido de novo), em vez de uma política de rehashing explícito ou de remoção orientada pelo fator de carga gerenciando o tamanho da tabela.

### Exemplo 3: Resolvendo apenas o próximo salto, através de um roteador

O host A (na rede `192.168.1.0/24`) quer alcançar o host C (em uma rede diferente, `10.0.5.0/24`), alcançável via roteador R.

```text
1. A lógica de encaminhamento do host A (conforme roteamento já coberto) determina
   que o próximo salto para este destino é o roteador R, não o host C diretamente.

2. O host A usa ARP para resolver o endereço MAC do ROTEADOR R (não o do host C):
   R está na própria rede local de A, então esta resolução ARP é inteiramente
   local e funciona normalmente.

3. O host A envia seu quadro com MAC de destino = endereço MAC de R, mas
   o datagrama de camada de rede INTERNO do quadro ainda especifica o
   endereço IP do host C como o destino final.

4. O roteador R recebe o quadro, remove o cabeçalho de camada de enlace, vê que o
   datagrama de camada de rede é destinado ao host C, e executa separadamente
   SUA PRÓPRIA resolução ARP (em SUA PRÓPRIA rede local, onde C reside)
   para encontrar o endereço MAC real de C para o próximo salto.
```

O host A nunca resolve o endereço MAC do host C diretamente, apenas o do próximo salto imediato, em cada enlace ao longo do caminho, correspondendo exatamente ao escopo genuinamente local e salto-a-salto do ARP.

## Equívocos Comuns e Armadilhas

- **"O ARP resolve o endereço MAC do destino final, não importa quantos saltos de distância ele esteja."** O ARP só resolve o endereço MAC do *próximo salto* na rede local, que a lógica de roteamento/encaminhamento já coberta determinou. Para um destino distante, esse próximo salto é tipicamente um roteador local, não o destino final em si, e cada roteador ao longo do caminho realiza sua própria resolução ARP separada e local para seu próprio próximo salto por sua vez.
- **"O cache ARP precisa de uma estrutura de dados completamente diferente de qualquer coisa já coberta neste currículo."** Ele é mecanicamente uma tabela hash: endereço IP como chave, endereço MAC como valor, busca em tempo constante no caso médio, com apenas sua estratégia de remoção (expiração baseada em timeout) diferindo do rehashing orientado pelo fator de carga já coberto para tabelas hash em geral.
- **"Uma requisição ARP alcança apenas o nó específico sobre o qual se pergunta."** Uma requisição ARP é transmitida em broadcast para todo nó na rede local: todo nó a recebe, e apenas o único nó cujo endereço IP de fato corresponde responde; todo outro nó simplesmente a ignora.
- **"O ARP funciona através de redes diferentes, conectadas por roteadores, diretamente."** O ARP tem escopo inteiramente de uma única rede local (um domínio de broadcast): resolver um endereço em uma rede genuinamente diferente requer a própria resolução ARP separada daquela rede diferente, realizada por qualquer roteador que esteja diretamente conectado a ela, não uma única requisição ARP abrangendo ambas as redes de uma vez.

## Resumo

O ARP faz a ponte entre o endereçamento IP da camada de rede e o endereçamento MAC da camada de enlace: dado um endereço IP conhecido na rede local, ele resolve o endereço MAC correspondente necessário para de fato construir um quadro de camada de enlace para o próximo salto, via uma requisição de broadcast respondida por uma resposta unicast do único nó correspondente. O cache ARP resultante é, mecanicamente, exatamente a tabela hash já coberta: endereço IP como chave, endereço MAC como valor, busca rápida no caso médio, diferindo apenas no uso de uma política de remoção baseada em timeout em vez de uma estratégia de rehashing explícita. O escopo do ARP é deliberadamente local: ele resolve apenas o próximo salto imediato em um único domínio de broadcast, nunca um destino distante diretamente, com cada roteador ao longo de um caminho de múltiplos saltos realizando sua própria resolução separada e local para seu próprio próximo salto por sua vez. O próximo conceito se volta para um cenário de camada física genuinamente diferente, o sem fio, onde as suposições de meio compartilhado em que o protocolo de acesso múltiplo da Ethernet se apoiava se desfazem de novas maneiras.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão sobre ARP e resolução de endereços.
