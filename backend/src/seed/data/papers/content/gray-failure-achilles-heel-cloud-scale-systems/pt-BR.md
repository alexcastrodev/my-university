---
title: "Gray Failure: o calcanhar de Aquiles dos sistemas em escala de nuvem"
summary: Um position paper do HotOS, vindo da Microsoft, que define gray failure como observabilidade diferencial, o estado em que uma aplicação vê o sistema falhando enquanto o detector de falhas do próprio sistema o vê saudável, e o ilustra com incidentes do Azure.
researchArea: Sistemas distribuídos
keywords: gray failure, observabilidade diferencial, detecção de falhas, falhas parciais, confiabilidade em nuvem, monitoramento de saúde, Azure
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

A escala da nuvem oferece os vastos recursos necessários para substituir componentes defeituosos, mas isso só serve se as falhas puderem ser detectadas. Por isso, as grandes quebras de disponibilidade e anomalias de desempenho que os autores veem em ambientes de nuvem tendem a ser causadas por falhas sutis, isto é, gray failure, e não por falhas do tipo fail-stop. O artigo discute experiências com gray failure em sistemas de produção em escala de nuvem para mostrar seu alcance e suas consequências. Também defende que uma característica central do gray failure é a observabilidade diferencial: os detectores de falha do sistema podem não perceber problemas mesmo quando as aplicações são afetadas por eles. Isso leva os autores a crer que, para lidar melhor com essas falhas, o foco deve estar em fechar a lacuna entre as percepções que diferentes componentes têm do que é uma falha.

## Visão geral

Sistemas tolerantes a falhas costumam ser construídos com três ingredientes: redundância, detecção de falhas e recuperação. Eles funcionam bem quando um componente está correto ou parado. Este artigo do HotOS 2017, de pesquisadores da Microsoft Research e do Microsoft Azure (o primeiro autor também estava na Johns Hopkins University), parte da observação de que incidentes reais em nuvem muitas vezes não são nem uma coisa nem outra. Um componente continua respondendo a heartbeats enquanto seu disco falha de forma intermitente, seu caminho de rede descarta pacotes aleatoriamente ou ele sofre pressão de capacidade. Os autores chamam isso de gray failure e dizem que, na experiência direta deles com sistemas de nuvem em produção, ela está por trás da maioria dos incidentes.

É um position paper de seis páginas, sem sistema e sem benchmark. Seu valor está no vocabulário e no modelo: os autores o descrevem como a primeira tentativa de caracterizar o gray failure, um problema que dizem ser em grande parte ignorado na literatura.

Contexto útil do catálogo: as técnicas clássicas de redundância e consenso que o artigo diz assumirem um modelo fail-stop, como [The Part-Time Parliament](/papers/paxos-part-time-parliament) e [Chain Replication](/papers/chain-replication-high-throughput-availability), e [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance), que o artigo discute como forma de mascarar o gray failure. Um artigo posterior do HotOS sobre tema relacionado é [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems).

## Contribuição

- **Uma definição.** Gray failure é uma forma de observabilidade diferencial: um sistema sofre gray failure quando pelo menos uma aplicação o observa como não saudável enquanto o observador do próprio sistema o observa como saudável.
- **Um modelo.** Um sistema presta um serviço e uma app o usa (uma aplicação web, um usuário, um operador ou outro sistema). Dentro do sistema, um observador reúne informação, de forma ativa ou passiva, e um reator age sobre ela para recuperar o sistema. Observador e reator fazem parte do sistema.
- **Uma taxonomia de quatro casos** (Tabela 1), cruzando "o sistema observa bom ou ruim" com "a app observa bom ou ruim". Gray failure é o caso em que a app vê ruim e o observador vê bom.
- **Um padrão temporal.** Uma falha latente vira um modo degradado que a app enxerga e o observador não, e termina em uma falha completa que o observador enfim percebe. No modelo, é o caminho do caso 1 ao caso 2 e ao caso 4.
- **Estudos de caso do Azure** que mostram como redundância, detectores de falha e recuperação podem se comportar mal sob gray failure.
- **Direções** para fechar a lacuna de observação (veja Resultados).

## Metodologia

O artigo se apoia no que os autores chamam de estudo extenso de incidentes reais em serviços de nuvem do Azure, do qual destacam alguns casos ilustrativos. Não relata um corpus sistemático, contagens de incidentes nem percentuais, e não faz experimentos. O modelo da Seção 3 é então aplicado a dois dos casos para mostrar que os explica. A seção de trabalhos relacionados situa o artigo frente à discussão de Gray sobre Heisenbugs, aos estudos de interrupções de Gunawi e colegas, às falhas fail-slow de um estudo interno da Microsoft, à tolerância a falhas bizantinas, aos detectores Falcon e Pigeon e ao diagnóstico estatístico de desempenho.

## Resultados

Os "resultados" são quatro estudos de caso e um conjunto de observações. São qualitativos.

- **Alta redundância atrapalha.** Em uma rede Clos de data center, um switch que para é contornado, mas um switch com descarte aleatório e silencioso de pacotes em geral não é. Se uma requisição se espalha por m servidores de back-end e há n switches de núcleo, a chance de um dado switch de núcleo estar no caminho da requisição é 1 - ((n-1)/n)^m, que tende a 100% quando m cresce. Assim, um único switch com gray failure atrasa quase toda requisição de front-end, e acrescentar switches de núcleo torna mais provável que pelo menos um esteja em gray failure.
- **Abaixo do radar dos detectores.** VMs não saudáveis do Azure tinham problemas internos de conectividade de rede, por exemplo por um bug de driver. Os heartbeats do gerenciador de computação chegam por um agente do host via RPCs locais, então nunca exercitam a rede externa da VM, e nada foi recuperado até um usuário relatar o problema (Figura 3).
- **Recuperação que mata em vez de curar.** Um servidor de dados com restrição de capacidade não foi detectado por causa de um bug no relato de recursos. O gerenciador de armazenamento continuou enviando escritas a ele, que travou e reiniciou várias vezes, até ser retirado como irrecuperável. Com outra sutileza no fluxo de replicação, isso reduziu a capacidade total, pressionou os servidores saudáveis e terminou em uma falha em cascata.
- **O jogo de empurrar a culpa.** Uma VM que não alcança seu disco virtual trava, e o detector de falhas da computação pode culpar a pilha de computação quando o problema está no armazenamento ou na rede. Os autores relatam equipes culpando umas às outras por falta de evidência clara.
- **Encaixe no modelo.** No caso da rede, os switches são os observadores e o roteamento é o reator. No caso do armazenamento, o gerenciador é observador e reator ao mesmo tempo, e cada queda e reinício faz a diferença de observação sumir e reaparecer, até sumir de vez tarde demais.
- **Direções.** (1) Sair da detecção por um único sinal, como heartbeats, para um monitoramento de saúde multidimensional, com a analogia de temperatura e pressão arterial. (2) Aproximar a visão da aplicação com sondas, como no Pingmesh, sem sobrecarregar um sistema já degradado. (3) Usar a escala, agregando observações parciais de muitos componentes, possivelmente em um plano independente fora do sistema central. (4) Usar padrões temporais, já que houve uma janela entre o instante t1, em que a computação viu um aumento de exceções de E/S, e o instante t2, em que o armazenamento reagiu.

## Análise crítica

O que o artigo não afirma. Ele não dá uma taxa de incidência além de dizer que o gray failure está por trás da maioria dos incidentes na experiência dos autores. Não propõe nem avalia um detector. Não diz que técnicas de mascaramento como o BFT estão erradas, apenas que são caras na prática, difíceis de tornar robustas à lentidão e deixam componentes falhos sem substituição. Também não diz que o gray failure é exclusivo de sistemas grandes: a definição independe da escala, embora a discussão se concentre em sistemas distribuídos grandes.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **A evidência é anedótica por construção.** Quatro casos motivam uma definição geral. Isso serve a um artigo de HotOS, mas a afirmação sobre "a maioria dos incidentes" não pode ser verificada pelo texto.
- **A definição depende de quem conta como app.** Se qualquer app pode declarar o sistema não saudável, uma aplicação com bug ou muito exigente pode criar gray failure no papel. O artigo nota que as apps podem usar métricas diferentes, mas não dá regra para decidir quando a observação de uma app é a que importa.
- **As direções também têm custo.** O próprio artigo alerta que mais sondagem pode sobrecarregar um sistema degradado e que padrões temporais arriscam falsos positivos, já que a maioria das falhas latentes é benigna.
- **Literatura posterior, fora deste artigo.** O trabalho de continuação dos próprios autores inclui "Capturing and Enhancing In Situ System Observability for Failure Detection" (Huang et al., OSDI 2018) e "Understanding, Detecting and Localizing Partial Failures in Large System Software" (Lou, Huang e Smith, NSDI 2020). Conferi os títulos e as conferências nas páginas da USENIX e na lista de publicações do primeiro autor, não os textos completos. O vocabulário próximo de [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) ajuda, mas os dois artigos descrevem mecanismos diferentes: lá, um laço de realimentação mantém o sistema em um estado ruim depois que o gatilho passa; aqui, uma lacuna entre observadores esconde o estado ruim do detector.

## Pesquisas futuras

- Como decidir, para um dado sistema, quais observações de apps valem como verdade sobre a saúde.
- Sondas que aproximem as visões das apps sem somar carga a um sistema degradado, e onde colocar o plano de agregação e inferência em relação ao sistema central.
- Detectar a fase de falha latente cedo o bastante para agir, com uma taxa tolerável de falsos positivos.
- Detectores de falha que exponham incerteza em vez de um veredito binário, na direção dos trabalhos Pigeon e Falcon citados pelo artigo, e a pergunta de como o [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus), que evita depender de timeouts, se comporta sob gray failure.
