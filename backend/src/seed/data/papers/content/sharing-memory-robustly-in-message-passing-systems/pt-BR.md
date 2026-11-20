---
title: "Compartilhando memória de forma robusta em sistemas de troca de mensagens"
summary: Attiya, Bar-Noy e Dolev emulam um registrador atômico de um escritor e vários leitores, sem espera, em uma rede assíncrona de troca de mensagens na qual menos da metade dos processadores pode parar. O escritor envia um valor com rótulo a uma maioria e espera os reconhecimentos de uma maioria, e o leitor consulta uma maioria e anuncia a uma maioria o que vai devolver antes de devolvê-lo.
researchArea: Sistemas distribuídos
keywords: registrador atômico, emulação, maioria, sem espera, troca de mensagens, rótulos de tempo, falhas de parada
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

São apresentados emuladores que traduzem algoritmos do modelo de memória compartilhada para dois modelos diferentes de troca de mensagens. Ambos são obtidos implementando um registrador atômico, sem espera, de um escritor e vários leitores em redes assíncronas e não confiáveis. Os dois modelos considerados são uma rede completa com falhas de processadores e uma rede arbitrária com falhas dinâmicas de enlaces. Esses resultados permitem ver o modelo de memória compartilhada como uma linguagem de nível mais alto para projetar algoritmos em sistemas distribuídos assíncronos. Qualquer algoritmo sem espera baseado em registradores atômicos de um escritor e vários leitores pode ser emulado automaticamente em sistemas de troca de mensagens, desde que ao menos uma maioria dos processadores não seja falha e permaneça conectada. O custo adicional dessas emulações é polinomial no número de processadores do sistema.

## Visão geral

O artigo saiu no Journal of the ACM em janeiro de 1995, depois de uma primeira versão no ACM Symposium on Principles of Distributed Computing, em agosto de 1990. Na época, projetar algoritmos tolerantes a falhas era mais fácil no modelo de memória compartilhada, em que um registrador continua legível mesmo com processadores lentos ou parados, do que no de troca de mensagens, em que cada processador tem uma visão local diferente. Os autores constroem uma ponte: se um único registrador pode ser emulado sobre mensagens, todo algoritmo sem espera escrito sobre esses registradores passa para uma rede, e a memória compartilhada vira, nas palavras deles, um "laboratório" para algoritmos resilientes.

O protocolo da Seção 4 é conhecido hoje como ABD, pelas iniciais dos autores. O próprio artigo nunca usa esse nome, nem a palavra "quórum": ele diz "maioria". O registrador construído é atômico no sentido de [Linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects), e o artigo cita a definição de Lamport. O modelo é o assíncrono do [FLP](/papers/flp-impossibility-of-distributed-consensus), e o resultado escapa dessa impossibilidade porque um registrador é mais fraco que o consenso. Uma entrada mais recente que parte desse protocolo é o [SWARM](/papers/swarm-replicating-shared-disaggregated-memory-data).

Vale saber antes: o que é uma operação sem espera, a diferença entre uma leitura que devolve o valor mais recente e outra que pode devolver um valor mais antigo, e por que duas maiorias quaisquer do mesmo conjunto de processadores compartilham ao menos um membro.

## Contribuição

- **Uma primitiva, communicate.** Um processador envia uma mensagem a todos e coleta reconhecimentos de uma maioria, não de algum processador em particular. Uma regra de ping-pong mantém uma mensagem em trânsito por enlace e no máximo 2n mensagens por chamada.
- **O emulador sem limite (Seção 4).** O escritor anexa a cada valor um rótulo inteiro crescente e o envia a uma maioria. O leitor pergunta a uma maioria pelos rótulos mais recentes, adota o maior e o anuncia a uma maioria antes de devolver.
- **O emulador limitado (Seção 5).** O inteiro é trocado por um sistema limitado e sequencial de rótulos de tempo, com mensagens extras de registro para que o escritor descubra todos os rótulos ainda vivos no sistema.
- **Redes arbitrárias (Seção 6).** Duas modificações tratam enlaces que falham e se recuperam: protocolos fim a fim sobre enlaces virtuais e uma versão de communicate como computação difusora.
- **Consequências.** Aplicar os emuladores a algoritmos conhecidos de memória compartilhada dá protocolos de troca de mensagens para registradores de vários escritores, sistemas de rótulos de tempo concorrentes, l-exclusão, instantâneos atômicos, consenso aleatorizado e estruturas de dados.

## Metodologia

O artigo é analítico. Ele fixa os modelos (processadores como máquinas de estados, execuções como sequências de passos de entrega e de computação, mensagens que podem ser perdidas ou reordenadas, mas nunca duplicadas nem corrompidas), define um registrador atômico por duas propriedades e fixa quatro medidas de custo: mensagens, tamanho das mensagens, tempo e memória local. Para o tempo, supõe que toda mensagem chega em uma unidade de tempo ou nunca chega. A correção se apoia em lemas com provas, resumidos em pseudocódigo de cada emulador. Não há implementação nem experimento. Li o texto inteiro; os valores assintóticos abaixo foram conferidos nos teoremas.

## Resultados

- **Atomicidade pela interseção de maiorias.** O lema central (4.4) diz que, se uma chamada de communicate terminou antes de outra começar, o rótulo reconhecido pela segunda é pelo menos o rótulo enviado pela primeira, porque as duas maiorias compartilham um processador.
- **A fase de anúncio é necessária.** Sem ela, uma leitura poderia devolver o rótulo de uma escrita concorrente e uma leitura posterior devolver um rótulo anterior, o que viola a segunda propriedade da atomicidade.
- **Emulador sem limite, Teorema 4.9.** Tolera no máximo (n - 1)/2 (arredondado para baixo) falhas de processadores, com O(n) mensagens e O(1) de tempo por operação: no máximo 4n mensagens e 4 unidades de tempo por leitura, no máximo 2n mensagens e 2 unidades por escrita. A memória local é O(n) vezes o tamanho do rótulo.
- **Emulador limitado, Teorema 5.4.5.** Mesma resiliência, com O(n^2) mensagens de tamanho O(n^3), O(1) de tempo (no máximo 12 unidades, Lema 5.4.3) e O(n^4) de memória local.
- **Redes arbitrárias.** A versão fim a fim (Teorema 6.1) exige O(n^5) mensagens e O(n^2) de tempo por operação. A versão difusora (Teorema 6.2) exige O(n^4) mensagens, de tamanho O(n^3), e O(n^2) de tempo, com espaço local ilimitado por causa das construções de Afek e Gafni que ela usa.
- **Por que uma maioria.** Na introdução, os autores argumentam que, para muitos problemas de coordenação global, um adversário forte pode dividir os processadores em dois grupos com menos que a maioria que nunca se ouvem. Um processador isolado de uma maioria é tratado como falho e fica bloqueado, mas nunca devolve um valor errado.

## Análise crítica

- **O limite da maioria é argumentado, não provado aqui.** O raciocínio é informal e remete a um trabalho anterior citado como Attiya et al. [1989], para "muitos problemas". Não há teorema específico sobre registradores, nem limite inferior para o custo da emulação: a Seção 7 deixa os limites inferiores como questão aberta.
- **Só um escritor.** O registrador de vários escritores aparece como consequência de aplicar o emulador a construções anteriores de memória compartilhada, com custo polinomial, e não como um protocolo dedicado. A literatura posterior (vista aqui apenas como registro bibliográfico, sem leitura completa) inclui Lynch e Shvartsman, "Robust emulation of shared memory using dynamic quorum-acknowledged broadcasts" (FTCS 1997), e o serviço RAMBO, de Gilbert, Lynch e Shvartsman (Distributed Computing, 2010). A entrada do SWARM descreve a forma comum para vários escritores, em que a escrita primeiro busca um timestamp novo, e relata duas viagens de ida e volta para gets e updates na sua própria linha de base ABD; esses números não são deste artigo.
- **A leitura é o lado caro.** Uma leitura leva duas fases e até 4n mensagens, contra 2n da escrita. O artigo não diz se a segunda fase pode ser dispensada.
- **A versão limitada é pesada.** Mensagens de tamanho O(n^3) e memória O(n^4) pagam pelos rótulos limitados, enquanto os autores admitem que contadores de 20 bits não dariam a volta na prática e defendem que soluções limitadas são mais resilientes a erros.
- **Só falhas de parada.** Um processador falho simplesmente para: não há recuperação, comportamento bizantino nem mentira. O resultado cobre um registrador, não consenso nem objetos gerais, e nada diz sobre desempenho em um sistema real.

## Pesquisas futuras

- Emulações mais baratas e limites inferiores, como o próprio artigo pede.
- Primitivas mais fortes. Read-Modify-Write resolve consenso, o que o [FLP](/papers/flp-impossibility-of-distributed-consensus) proíbe nesse modelo, então o artigo sugere detectores de falha ou mecanismos de reconhecimento automático, o caminho seguido por [Chandra e Toueg](/papers/unreliable-failure-detectors-for-reliable-distributed-systems) e depois por hipóteses de tempo como na [sincronia parcial](/papers/consensus-in-the-presence-of-partial-synchrony).
- Replicação baseada em consenso com o mesmo limiar de maioria, no [Paxos simplificado](/papers/paxos-made-simple) e no [Raft](/papers/raft-understandable-consensus-algorithm), e trabalhos posteriores que exigem só quóruns que se intersectam, no [Flexible Paxos](/papers/flexible-paxos-quorum-intersection-revisited).
- Garantias mais fracas em armazenamentos por quórum, como [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e [Cassandra](/papers/cassandra-decentralized-structured-storage-system), e garantias por cliente como as de [Session Guarantees](/papers/session-guarantees-for-weakly-consistent-replicated-data). A entrada do Dynamo observa que seus quóruns frouxos não dão consistência forte, o contraste com este artigo.
