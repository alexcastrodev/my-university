---
version: 1.0
updatedAt: 2026-09-06
title: "NAT e Tradução de Endereços de Rede"
summary: "Um roteador NAT reescreve o endereço e a porta de origem privados de todo pacote que sai para o seu próprio endereço público único e uma porta nova, mantendo uma tabela de tradução para rotear as respostas de volta ao host interno certo. É uma correção pragmática e amplamente implantada para a escassez de endereços que também, honestamente, quebra o princípio fim a fim em torno do qual a Internet foi originalmente projetada."
---
## Objetivos de Aprendizagem

- Explicar o problema de escassez de endereços que o NAT foi implantado para resolver, e por que as faixas de endereços privados sozinhas não o resolvem por completo.
- Rastrear como um roteador NAT reescreve o endereço e a porta de origem de um pacote que sai, e mantém uma tabela de tradução para rotear as respostas de volta corretamente.
- Explicar por que um único endereço IP público, via tradução de portas, consegue atender muitos hosts internos simultâneos.
- Enunciar honestamente o que o NAT quebra: o princípio fim a fim, e dar um exemplo concreto de uma complicação real que isso causa.
- Distinguir o NAT (um mecanismo do plano de dados, de reescrita por pacote) do roteamento (um mecanismo do plano de controle, de cálculo de caminhos), uma aplicação direta da distinção estabelecida mais cedo neste bloco.

## Contexto e Motivação

Os cerca de 4,3 bilhões de endereços do IPv4 pareciam enormes quando o protocolo foi projetado, décadas antes de a escala real da Internet (bilhões de dispositivos conectados) ficar aparente. Em vez de uma transição imediata e completa para um espaço de endereços maior (o IPv6, que de fato oferece um, mas cuja implantação completa levou décadas e ainda está em andamento), a Tradução de Endereços de Rede (NAT) virou o paliativo pragmático e amplamente implantado que deixou a Internet IPv4 continuar funcionando por muito mais tempo do que o seu espaço de endereços original sozinho teria permitido. Este conceito cobre como o NAT de fato funciona, mecanicamente, e é honesto sobre o custo arquitetural real que ele impõe, um custo que todo conceito seguinte sobre roteamento pela Internet mais ampla assume implicitamente que já foi tratado.

## Teoria Central

### O problema: endereços públicos insuficientes

Todo dispositivo que quer se comunicar diretamente na Internet pública tradicionalmente precisa do seu próprio endereço IP globalmente único, mas a demanda por endereços (bilhões de notebooks, celulares e outros dispositivos) excede de longe o espaço total de cerca de 4,3 bilhões de endereços do IPv4, especialmente quando se contabilizam as práticas de alocação desperdiçadoras que o CIDR só corrigiu parcialmente. As faixas de endereços privados (blocos como `10.0.0.0/8` e `192.168.0.0/16`, reservados especificamente para uso dentro de redes privadas e nunca roteados na Internet pública) permitem que uma organização ou uma residência use quantos endereços internos quiser sem precisar de tantos endereços públicos. Mas endereços privados sozinhos não são diretamente alcançáveis a partir da Internet pública, então é preciso algo que permita que os dispositivos que os usam ainda se comuniquem para fora.

### Como o NAT funciona

Um roteador NAT fica na fronteira entre uma rede privada (usando endereços privados internamente) e a Internet pública (onde ele tem um, ou um pequeno número, de endereços IP públicos genuínos). Quando um host interno envia um pacote para fora, o roteador NAT reescreve o endereço IP de origem do pacote (substituindo o endereço privado do host interno pelo endereço público do próprio roteador) e normalmente também reescreve o número da porta de origem (para uma porta nova, escolhida pelo roteador), e então registra essa tradução (endereço privado, porta privada, porta pública escolhida) numa tabela de tradução antes de encaminhar o pacote adiante. Quando chega uma resposta de fora, endereçada ao endereço público do roteador e àquela porta específica escolhida, o roteador consulta a sua tabela de tradução para determinar a qual host e porta internos a resposta deve de fato ser entregue, reescreve o endereço e a porta de destino de acordo, e encaminha a resposta para dentro.

### Tradução de portas: muitos hosts internos, um endereço público

Como o NAT reescreve números de porta, e não só endereços, um único endereço IP público consegue atender muitos hosts internos e conexões simultâneas ao mesmo tempo. A chave da tabela de tradução é o mapeamento de (endereço privado, porta privada) para (endereço público, porta pública), e desde que o roteador atribua uma porta pública distinta a cada conexão interna ativa, as respostas podem ser roteadas corretamente de volta ao host interno certo, mesmo que todas pareçam, vistas de fora, estar indo para ou vindo do mesmíssimo endereço IP público único.

### O que o NAT quebra: o princípio fim a fim

O projeto original da Internet assumia o princípio fim a fim: dois hosts que se comunicam têm os seus próprios endereços genuínos, estáveis e globalmente alcançáveis, e qualquer inteligência necessária para a comunicação pertence às pontas, e não ao interior da rede. O NAT genuinamente viola isso: um host interno atrás de NAT não tem um endereço estável e globalmente alcançável próprio do ponto de vista do mundo externo. Ele só é alcançável via a tabela de tradução do roteador NAT, que por sua vez só é preenchida em resposta a uma conexão de saída que o host interno iniciou. É precisamente por isso que uma conexão de entrada não solicitada para um host atrás de NAT (alguém de fora tentando iniciar contato com um host interno que não fez contato primeiro) geralmente não funciona sem configuração adicional (redirecionamento de portas, ou uma técnica de travessia de NAT). É uma complicação real e concreta para aplicações peer-to-peer e para certos protocolos que assumem que qualquer host pode ser alcançado diretamente.

### O NAT é um mecanismo do plano de dados, não uma decisão de roteamento

Coerente com a distinção entre plano de dados e plano de controle estabelecida mais cedo neste bloco, o NAT é uma operação de reescrita por pacote, realizada na mesma escala de tempo rápida do encaminhamento comum, usando uma tabela de tradução que o roteador mantém conforme as conexões são estabelecidas e encerradas. Ele não envolve recalcular rotas nem rodar um algoritmo de roteamento; ele simplesmente reescreve as informações de endereçamento dos pacotes conforme passam, e depois os encaminha usando a lógica de encaminhamento comum.

## Exemplos Resolvidos

### Exemplo 1: Rastreando uma conexão de saída pelo NAT

Um host interno em `10.0.0.5`, usando a porta local `40000`, envia um pacote para um servidor web público em `93.184.216.34:80`. O endereço público do próprio roteador NAT é `203.0.113.9`.

```text
1. O host interno envia: origem=10.0.0.5:40000, destino=93.184.216.34:80
2. O roteador NAT reescreve a origem e registra a tradução:
   origem reescrita para 203.0.113.9:60001 (porta pública escolhida pelo roteador)
   Entrada adicionada à tabela de tradução:
     (10.0.0.5:40000) <-> (203.0.113.9:60001)
3. O pacote é encaminhado ao servidor web como: origem=203.0.113.9:60001,
   destino=93.184.216.34:80
4. A resposta do servidor web chega endereçada a: destino=203.0.113.9:60001
5. O roteador NAT procura 60001 na sua tabela de tradução, descobre que
   ela mapeia para (10.0.0.5:40000), reescreve o destino de acordo e
   encaminha a resposta para dentro, ao host interno de fato.
```

Do ponto de vista do servidor web, ele só viu `203.0.113.9:60001`: ele não tem nenhuma visibilidade do endereço interno real `10.0.0.5`.

### Exemplo 2: Vários hosts internos compartilhando um endereço público

```text
Host interno A: 10.0.0.5:40000  →  traduzido para  203.0.113.9:60001
Host interno B: 10.0.0.8:50000  →  traduzido para  203.0.113.9:60002
Host interno C: 10.0.0.5:40001  →  traduzido para  203.0.113.9:60003
  (nota: de novo o host A, mas com uma porta local DIFERENTE; isto
   também precisa da sua própria entrada de tradução distinta, já que
   é uma conexão separada)
```

As três conexões parecem, do ponto de vista de qualquer host externo, se originar do único endereço público `203.0.113.9`; só os números de porta diferem, e a tabela de tradução do roteador NAT é o que roteia corretamente cada resposta de volta ao host e à porta internos certos, entre potencialmente milhares de conexões traduzidas simultâneas que ele pode estar acompanhando ao mesmo tempo.

### Exemplo 3: Por que uma conexão de entrada não solicitada falha sem configuração

Suponha que um host externo tente iniciar uma conexão totalmente nova diretamente com o host interno A em `10.0.0.5`, sem que nenhuma conexão de saída anterior de A tenha estabelecido uma entrada relevante na tabela de tradução:

```text
O host externo envia um pacote endereçado a 203.0.113.9 (o endereço
  público do roteador NAT) em alguma porta, esperando alcançar o host A.

O roteador NAT procura na sua tabela de tradução uma entrada que case
  com essa porta de destino e não encontra NADA, porque nenhuma conexão
  de saída de nenhum host interno jamais usou essa porta pública específica.

Resultado: o roteador não faz ideia de para qual host interno este
  pacote é (10.0.0.5 nunca foi de fato alcançável por essa porta pública
  específica a partir de fora), e o pacote normalmente é descartado.
```

Esta é exatamente a violação do princípio fim a fim nomeada acima, tornada concreta: sem uma entrada de tradução preexistente (criada só quando um host interno inicia uma conexão de saída primeiro), ou uma configuração manual explícita (redirecionamento de portas, dizendo ao roteador de antemão "sempre envie o tráfego da porta X para o host interno A"), um host externo simplesmente não consegue alcançar diretamente um host interno atrás de NAT.

## Equívocos Comuns e Armadilhas

- **"O NAT é um mecanismo de roteamento."** O NAT reescreve informações de endereçamento nos pacotes como uma operação do plano de dados; ele não calcula caminhos nem toma decisões de roteamento. Depois da reescrita, o pacote é encaminhado usando a lógica de encaminhamento comum e não relacionada, coerente com a distinção entre plano de dados e plano de controle estabelecida mais cedo neste bloco.
- **"O NAT resolveu o esgotamento de endereços IPv4 permanentemente."** O NAT é um contorno pragmático que reduziu drasticamente a *taxa* de consumo de endereços públicos (muitos hosts internos compartilhando um endereço público), mas não aumentou o espaço total de endereços disponível, que é o que o espaço de endereços muito maior do IPv6 foi de fato projetado para resolver.
- **"Todo host interno atrás de NAT é completamente inalcançável de fora."** Um host interno é inalcançável *por padrão*, na ausência de uma entrada de tradução preexistente criada por uma conexão de saída. Mas uma configuração explícita (redirecionamento de portas) ou técnicas adicionais de travessia de NAT podem habilitar uma alcançabilidade de entrada específica quando genuinamente necessário, ao custo de uma complexidade extra de configuração que a operação básica do NAT não exige.
- **"O NAT e as faixas de endereços privados são a mesma coisa."** As faixas de endereços privados (como `10.0.0.0/8`) são simplesmente blocos de endereços reservados que não são roteados na Internet pública; o NAT é o mecanismo ativo e separado que de fato permite que hosts usando esses endereços privados se comuniquem com a Internet pública, reescrevendo o seu endereçamento na fronteira da rede.

## Resumo

O NAT permite que muitos hosts internos, usando endereços privados não alcançáveis diretamente a partir da Internet pública, compartilhem um (ou um pequeno número de) endereço IP público, reescrevendo o endereço e a porta de origem dos pacotes que saem e mantendo uma tabela de tradução para rotear corretamente as respostas de volta ao host interno certo. A tradução de portas é especificamente o que permite que muitas conexões internas simultâneas compartilhem um único endereço público sem ambiguidade. Esta foi uma resposta genuinamente pragmática e amplamente implantada à escassez de endereços IPv4, mas tem um custo arquitetural real: ela quebra o princípio fim a fim, já que um host interno atrás de NAT não é alcançável de forma estável e direta por uma conexão externa não solicitada sem configuração adicional, uma complicação real para aplicações peer-to-peer e certos protocolos. O NAT em si é um mecanismo do plano de dados, de reescrita por pacote, distinto e não relacionado aos conceitos de algoritmos de roteamento do plano de controle (link-state e distance-vector) cobertos a seguir neste bloco.

## Documentation Links

- [Stanford CS144: Lecture Schedule ("DCCP & NAT")](https://www.scs.stanford.edu/10au-cs144/sched/): uma aula de um curso real que cobre o NAT diretamente.
- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão do NAT e das suas implicações para o princípio fim a fim.
