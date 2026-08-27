---
title: "Estimativa de Capacidade em Guardanapo (Back-of-the-Envelope)"
description: Como transformar "projete um sistema para um bilhão de usuários" em números concretos de QPS, armazenamento e banda em alguns minutos de aritmética — atalhos de potências de dois, os números de latência que todo engenheiro deveria ter memorizados, e por que o ponto real não é precisão, é capturar um design que está errado por três ordens de grandeza antes de você construí-lo.
difficulty: Intermediate
readingTime: 12
tags:
  - System Design
  - Performance
  - Escalabilidade
  - Sistemas Distribuídos
  - Estimativa
prerequisites:
  - label: "Describing Performance: Latency, Response Time, and Percentiles"
    slug: describing-performance-latency-and-percentiles
  - label: "Horizontal vs. Vertical Scaling"
    slug: horizontal-vs-vertical-scaling
related:
  - label: "Designing a URL Shortener"
    slug: url-shortener
  - label: "Scalability and Maintainability: Load Parameters and the Operability-Simplicity-Evolvability Triad"
    slug: scalability-and-maintainability-principles
  - label: "Object Storage and the Direct-Upload Pattern"
    slug: object-storage-and-direct-upload
  - label: "Designing a Distributed Key-Value Store"
    slug: key-value-store-design
---

## Visão Geral

Antes de escolher um banco de dados, uma estratégia de caching, ou um esquema de sharding, um engenheiro sênior deveria conseguir verificar a sanidade da escala real do problema em alguns minutos de aritmética. A estimativa em guardanapo transforma um prompt vago — "projete um sistema para um bilhão de usuários" — em números concretos para requisições por segundo, crescimento de armazenamento e banda, usando nada mais que um punhado de suposições declaradas, atalhos de potências de dois, e uma lista curta de números de latência que vale a pena memorizar. O objetivo nunca é precisão: ninguém espera que o terceiro dígito significativo esteja certo, e um número computado com cinco casas decimais a partir de três entradas chutadas é falsa confiança disfarçada de rigor. O ponto real é capturar uma suposição que está errada por uma ou mais ordens de grandeza — uma carga de trabalho que na verdade é 200.000 QPS, não 200 — antes que ela conduza a uma decisão de design cara. A diferença entre "uma única instância Postgres com uma réplica de leitura" e "um key-value store globalmente shardeado com replicação assíncrona" é visível já na primeira passada de aritmética, não seis meses depois em um teste de carga que falha em produção.

## Potências de Dois e Números Redondos

A estimativa desmorona se cada passo carrega suas próprias unidades. A correção, usada ao longo de *System Design Interview* de Alex Xu e Sahn Lam (ByteByteGo, 2020), Capítulo 2, é memorizar a correspondência entre potências de dois e potências de dez e usá-la como uma tabela de consulta mental em vez de uma calculadora:

| Potência de 2 | Valor exato | Aproximação | Unidade comum |
|---|---|---|---|
| 2^10 | 1.024 | ~1 mil | KB |
| 2^20 | 1.048.576 | ~1 milhão | MB |
| 2^30 | 1.073.741.824 | ~1 bilhão | GB |
| 2^40 | 1.099.511.627.776 | ~1 trilhão | TB |
| 2^50 | 1.125.899.906.842.624 | ~1 quatrilhão | PB |

O erro introduzido por essa aproximação é abaixo de 12% mesmo em 2^50, e nunca se acumula ao longo de um cálculo da forma que uma *suposição de entrada* errada acumula — uma estimativa de armazenamento errada por 12% e uma estimativa de armazenamento errada por 100x exigem reações completamente diferentes, e esse atalho só arrisca a primeira. O que ele te dá é velocidade: você pode converter "3 bilhões de linhas" quase instantaneamente em "um pouco menos que 2^32" sem tocar em uma calculadora, o que importa quando o exercício real é rodar cinco ou seis dessas conversões em sequência — DAU para QPS, QPS para requisições diárias, requisições para armazenamento, armazenamento para banda — sem perder o fio. É uma camada de cache mental para unidades, não uma fonte de precisão, e nunca deveria ser a desculpa para pular o passo mais difícil: declarar suas suposições explicitamente para que outra pessoa possa desafiar a que realmente está errada.

## Números de Latência que Todo Engenheiro Deveria Saber

Algumas estimativas não são sobre volume de forma alguma — são sobre se uma arquitetura é sequer fisicamente plausível. Um design que faz uma chamada síncrona entre regiões dentro de uma requisição que deveria completar em 10 ms está morto na largada independentemente de como a matemática de QPS se resolva, e a única forma de capturar isso em alguns segundos é já ter ordens de grandeza aproximadas para operações fundamentais memorizadas. A referência canônica é a tabela "Latency Numbers Every Programmer Should Know", popularizada a partir de uma palestra interna do Google por Jeff Dean, depois construída em uma comparação interativa por Peter Norvig, Colin Scott e Jonas Bonér que rastreia como esses números mudam entre gerações de hardware:

| Operação | Latência aproximada |
|---|---|
| Referência ao cache L1 | ~1 ns |
| Referência à memória principal | ~100 ns |
| Ler 1 MB sequencialmente da memória | ~10 μs |
| Leitura aleatória em SSD | ~150 μs |
| Ida e volta dentro do mesmo datacenter | ~500 μs |
| Ler 1 MB sequencialmente de SSD | ~1 ms |
| Busca em disco | ~10 ms |
| Enviar pacote CA → Holanda → CA | ~150 ms |

Duas coisas importam mais que os números exatos. Primeiro, memória é aproximadamente 100.000x mais rápida que uma busca em disco e aproximadamente 1.000x mais rápida que uma leitura aleatória em SSD — os números específicos variam com o hardware, mas essa proporção se manteve por mais de uma década e é a justificativa inteira para caching como um padrão arquitetural em vez de uma reflexão tardia de performance. Segundo, uma ida e volta no mesmo datacenter (~500 μs) versus uma entre continentes (~150 ms) é uma lacuna de 300x — que é por que "apenas adicione uma chamada síncrona para outra região" é uma bandeira vermelha em qualquer design que tenha um orçamento de latência abaixo de um segundo. Esses números são ilustrativos e aproximados; trate-os como a ordem de grandeza certa para raciocinar, não um benchmark para citar em um post-mortem.

## Estimando QPS a Partir de Usuários Ativos Diários

A maioria dos problemas de estimativa começa a partir de um único número dado — usuários ativos diários (DAU) — e um pequeno conjunto de comportamentos assumidos, então deriva tudo mais:

1. **Requisições diárias** = DAU × requisições por usuário por dia para a operação em questão.
2. **QPS médio** = requisições diárias / 86.400 (segundos em um dia; arredonde para 100.000 por velocidade).
3. **QPS de pico** = QPS médio × um fator de pico, tipicamente 2–3x para tráfego de consumidor com um padrão diurno, mais alto para qualquer coisa com risco de multidão-relâmpago (venda de ingressos, notícias de última hora).

O fator de pico é o passo que as pessoas pulam e não deveriam: provisionar para o QPS médio em um sistema com um forte ciclo diário garante que ele caia durante o horário comercial em seu próprio fuso horário mais movimentado. Quando um prompt dá entradas ambíguas, declare a suposição em voz alta (ex.: "vou assumir que 10% dos usuários registrados são ativos diariamente, e cada um realiza 20 operações de leitura para cada escrita") — o número importa menos que tornar o raciocínio inspecionável para que um revisor possa desafiar a suposição que realmente está errada.

## Estimando Armazenamento

Estimativas de armazenamento encadeiam três quantidades: quantos registros são escritos por unidade de tempo, quão grande é cada registro, e por quanto tempo são retidos.

`armazenamento total ≈ registros por dia × tamanho médio do registro × período de retenção`

O tamanho do registro é a suposição mais frequentemente errada, porque é tentador dimensionar apenas o payload primário e esquecer metadados, índices e replicação. Uma linha "pequena" com um timestamp, algumas chaves estrangeiras, e um enum de status raramente fica abaixo de 100 bytes uma vez que o overhead é incluído; um blob JSON ou um objeto embutido pode ser uma ordem de grandeza maior. Multiplique o volume de dados brutos pelo fator de replicação (comumente 3x para durabilidade) e por um fator de overhead de índice (comumente 1,1–1,5x) antes de chamar um número de final — pular esse passo é como "36 TB" silenciosamente vira "150 TB" de pegada real de disco.

## Estimando Banda

A estimativa de banda tem a mesma forma da estimativa de QPS, apenas multiplicada pelo tamanho do payload em vez de dividida por segundos:

`banda ≈ requisições por segundo × tamanho médio do payload`

Compute-a separadamente para ingress (o que o serviço recebe — uploads, escritas) e egress (o que envia — respostas, downloads, ativos estáticos), porque os dois são frequentemente assimétricos por uma ordem de grandeza ou mais: um serviço de compartilhamento de fotos ingere um upload em resolução completa uma vez e serve uma miniatura comprimida milhares de vezes, então egress domina e é onde o offload de CDN (veja [Object Storage and the Direct-Upload Pattern](object-storage-and-direct-upload)) ganha seu valor. Um serviço intensivo em metadados — um encurtador de URL, uma consulta de grafo social — frequentemente mostrará números de banda tão pequenos que não são o gargalo de forma alguma, e o valor real da estimativa é confirmar isso e redirecionar atenção para QPS ou armazenamento em vez disso.

## Um Exemplo Resolvido: Estimando um Encurtador de URL

Pegue o prompt clássico: dimensione um serviço estilo TinyURL. Assuma 100 milhões de novos links curtos criados por dia, uma proporção leitura:escrita de 10:1 (redirecionamentos superam vastamente criações), uma URL longa média de 500 bytes, uma linha armazenada de 100 bytes (código, hash, timestamp, metadados), e um requisito de retenção de 10 anos.

| Passo | Cálculo | Resultado |
|---|---|---|
| QPS de escrita (médio) | 100.000.000 / 86.400 | ≈ 1.160 escritas/seg |
| QPS de escrita (pico, ×2) | 1.160 × 2 | ≈ 2.320 escritas/seg |
| Redirecionamentos diários | 100.000.000 × 10 | 1.000.000.000 /dia |
| QPS de leitura (médio) | 1.000.000.000 / 86.400 | ≈ 11.600 leituras/seg |
| QPS de leitura (pico, ×2) | 11.600 × 2 | ≈ 23.200 leituras/seg |
| Linhas em 10 anos | 100.000.000 × 365 × 10 | 365.000.000.000 linhas (≈ 2^38,4, então um pouco abaixo de 2^40) |
| Armazenamento bruto | 365.000.000.000 × 100 bytes | ≈ 36,5 TB |
| Armazenamento com replicação 3x | 36,5 TB × 3 | ≈ 110 TB |
| Banda de escrita (ingress) | 1.160/seg × 500 bytes | ≈ 580 KB/s |
| Banda de leitura (egress) | 11.600/seg × ~300 bytes (resposta de redirecionamento) | ≈ 3,5 MB/s |

Ler os resultados, não apenas produzi-los, é a habilidade real. A proporção leitura:escrita de 10:1 significa que o caminho de redirecionamento é o que precisa de um cache e o de criação não — esse único número decide para onde o esforço de engenharia vai. 365 bilhões de linhas caem logo abaixo de 2^40, o que imediatamente te diz que o espaço de chaves precisa suportar pelo menos essa quantidade de códigos distintos: Base62 sobre 7 caracteres dá 62^7 ≈ 3,5 trilhões, confortavelmente acima, enquanto 6 caracteres (56 bilhões) não seria, e você aprende isso a partir da estimativa antes de escrever uma linha do gerador de ID (veja [Distributed ID Generation](distributed-id-generation) para como esse espaço é alocado sem colisões). Os números de banda, em contraste, são inexpressivos em ambas as direções — poucos megabytes por segundo não é um número que ninguém precisa arquitetar em torno — e esse resultado nulo é útil por si só: te diz para não gastar a entrevista, ou o documento de design, defendendo uma estratégia de CDN para um serviço onde banda nunca ia ser a restrição. Compare isso com um serviço servindo miniaturas de vídeo de 500 KB no mesmo pico de 23.200 QPS: egress sozinho seria mais de 11 GB/s, uma conversa completamente diferente que essa mesma aritmética teria revelado nos mesmos poucos minutos.

## Trade-offs

- **Estimativa captura erros de magnitude, não correção ou performance sob carga** — saber que você precisa lidar com aproximadamente 20.000 QPS não diz nada sobre se sua implementação real, topologia de rede, ou contenção de lock consegue sustentá-lo; matemática de guardanapo é uma verificação de sanidade em tempo de design, não um substituto para teste de carga.
- **Médias escondem o pico que realmente te quebra** — provisionamento baseado em QPS médio falha exatamente quando importa, porque tráfego real tem ciclos diurnos e multidões-relâmpago ocasionais; toda estimativa baseada em média precisa de um multiplicador de pico explícito ou está silenciosamente errada para o caso que conta.
- **A estimativa só é tão boa quanto suas suposições declaradas, e essas geralmente são chutes** — um "payload médio de 500 bytes" ou "proporção de 10% DAU-para-registrado" é afirmado, não medido; o valor do exercício é tornar a suposição visível e desafiável, não tratar o número resultante como fato.
- **Atalhos de potências de dois trocam um erro pequeno e limitado por velocidade** — até aproximadamente 12% em 2^50 — o que é aceitável porque o exercício já é tolerante a erro de ordem de grandeza; não seria aceitável em um contexto onde esses 12% são a questão real.
- **Não diz nada sobre comportamento de cauda ou modos de falha** — uma estimativa de que um sistema precisa sustentar 11.600 leituras/seg em média não te diz nada sobre o que acontece com o 1% mais lento dessas leituras, que é uma disciplina separada (veja [Describing Performance: Latency, Response Time, and Percentiles](describing-performance-latency-and-percentiles)).
- **É uma ferramenta de comunicação tanto quanto um cálculo** — em uma entrevista ou revisão de design, mostrar a aritmética passo a passo é o que demonstra julgamento; um número final correto sem raciocínio visível é muito menos convincente que um número aproximado alcançado transparentemente.

## Perguntas de Entrevista

- Um candidato estima que um sistema precisa de 50.000 QPS mas nunca declara um multiplicador de pico. O que há de errado em aceitar esse número ao pé da letra, e qual pergunta de acompanhamento expõe a lacuna?
- Te dizem que um serviço tem 500 milhões de DAU. Percorra converter isso em QPS de leitura e QPS de escrita dada uma proporção leitura:escrita declarada, e explique por que você verificaria a sanidade da própria proporção antes de confiar no resultado.
- Por que uma diferença entre uma ida e volta de 500 μs no mesmo datacenter e uma de 150 ms entre continentes importa mais para decisões de arquitetura do que para matemática de throughput bruto?
- Uma estimativa de armazenamento dá 40 TB antes de contabilizar replicação e overhead de índice. Que multiplicador você aplicaria, e por que pular isso leva a subprovisionamento?
- Para qual desses dois sistemas a estimativa de banda realmente mudaria o design: um encurtador de URL, ou um serviço servindo miniaturas de vídeo enviadas por usuários? Justifique a diferença usando a forma do payload, não apenas o QPS.
- Se duas suposições razoáveis diferentes para "requisições por usuário por dia" levam a estimativas que diferem por 3x, isso invalida o exercício? O que você deveria fazer com essa dispersão em vez de escolher um número e seguir em frente?

## Referências

- [Alex Xu e Sahn Lam, "System Design Interview – An Insider's Guide, Volume 1" (ByteByteGo, 2020) — Capítulo 2, "Back-of-the-Envelope Estimation"](https://bytebytego.com)
- [Colin Scott — "Latency Numbers Every Programmer Should Know" (visualização interativa, baseada nos números de Peter Norvig e Jeff Dean)](https://colin-scott.github.io/personal_website/research/interactive_latency.html)
- [Jonas Bonér et al. — "Latency Numbers Every Programmer Should Know" (GitHub Gist)](https://gist.github.com/jboner/2841832)
- [Google SRE Book — Capítulo 4: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)
</content>
