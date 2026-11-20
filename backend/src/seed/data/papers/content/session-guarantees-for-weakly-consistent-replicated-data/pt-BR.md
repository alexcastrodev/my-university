---
title: "Garantias de sessão para dados replicados com consistência fraca"
summary: Terry e colegas do Xerox PARC propõem quatro garantias por sessão (Read Your Writes, Monotonic Reads, Writes Follow Reads, Monotonic Writes) que dão a uma aplicação uma visão de um banco replicado read-any/write-any coerente com as próprias ações, e mostram como impô-las com um gerenciador de sessão e vetores de versão.
researchArea: Sistemas distribuídos
keywords: garantias de sessão, consistência fraca, consistência eventual, read your writes, monotonic reads, vetores de versão, Bayou
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Quatro garantias por sessão são propostas para ajudar usuários e aplicações de dados replicados com consistência fraca: Read Your Writes, Monotonic Reads, Writes Follow Reads e Monotonic Writes. A intenção é apresentar a cada aplicação uma visão do banco coerente com as próprias ações, mesmo que ela leia e escreva em vários servidores potencialmente inconsistentes. As garantias podem ser montadas sobre sistemas existentes que usam replicação read-any/write-any, mantendo os principais benefícios desse esquema: alta disponibilidade, simplicidade, escalabilidade e suporte a operação desconectada. Elas foram desenvolvidas no projeto Bayou, do Xerox PARC, no qual os autores projetam e constroem um sistema de armazenamento replicado para usuários de computação móvel que podem ficar conectados só de forma intermitente.

## Visão geral

Este artigo de 1994 (PDIS, páginas 140 a 149 segundo o Crossref; a cópia aberta tem 10 páginas) nasce do projeto do Bayou, um armazenamento replicado para usuários móveis e intermitentemente conectados. Em um sistema com consistência fraca, as atualizações se espalham devagar e o cliente pode ler de qualquer servidor. A observação central é que a inconsistência aparece mesmo quando um único cliente é o único a escrever: ele escreve em um servidor, lê em outro que ainda não soube da escrita, e a própria atualização parece ter sumido. O artigo cita o Grapevine, em que o usuário trocava a senha e depois recebia a resposta de senha inválida.

A solução preserva a arquitetura de consistência fraca. A consistência forte exigiria coordenação que réplicas desconectadas ou distantes não oferecem, o lado da disponibilidade do dilema que depois foi formalizado como [CAP](/papers/brewers-conjecture-cap-feasibility-web-services). Em vez disso, o artigo restringe, por sessão, quais servidores uma operação pode usar. A semântica-alvo é a de um único servidor centralizado (o extremo forte que a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) formaliza), mas só como vista por uma aplicação.

Vale saber antes: consistência eventual, anti-entropia (troca de escritas entre pares de servidores), relógios lógicos como no [artigo de Lamport](/papers/lamport-time-clocks-ordering-of-events) e o esquema read-any/write-any que o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) tornou familiar mais tarde.

## Contribuição

- **A abstração de sessão.** Uma sessão é a sequência de leituras e escritas de uma aplicação. Não é uma transação e não dá atomicidade nem serializabilidade. Cada garantia pode ser pedida de forma independente, por sessão.
- **Quatro garantias**, definidas sobre DB(S,t), a sequência ordenada de escritas que o servidor S recebeu até o instante t, e sobre um predicado WriteOrder(W1,W2) que ordena as escritas do mesmo jeito em todos os servidores.
  - Read Your Writes: se a leitura R vem depois da escrita W na sessão e roda no servidor S no instante t, então W está em DB(S,t).
  - Monotonic Reads: se R1 precede R2, então RelevantWrites(S1,t1,R1) é subconjunto de DB(S2,t2). RelevantWrites é o menor conjunto de escritas que determina o resultado de uma leitura.
  - Writes Follow Reads: se R1 precede W2 e W2 está em DB(S2), então toda escrita relevante de R1 também está em DB(S2) e é ordenada antes de W2.
  - Monotonic Writes: se W1 precede W2 e W2 está em DB(S2), então W1 está em DB(S2) e é ordenada antes de W2.
- **Variantes relaxadas** de Writes Follow Reads, WFRO (só ordem) e WFRP (só propagação), para aplicações que precisam de apenas uma das metades.
- **Uma implementação** com um gerenciador de sessão no cliente e vetores de versão, além de um esboço de como acrescentar as garantias ao Coda.

## Metodologia

É um artigo de projeto, com definições, exemplos e argumentação, não um trabalho experimental. A seção 2 fixa o modelo: cópias completas nos servidores, identificadores únicos de escrita (WIDs), anti-entropia e uma ordem consistente de escritas, sem definir como os conflitos são resolvidos. A seção 3 define cada garantia e traz nove exemplos (senhas, e-mail, calendário, base bibliográfica, mural de avisos, editor de texto, código-fonte). As seções 4 e 5 dão o algoritmo de imposição, primeiro com conjuntos de WIDs e depois com vetores de versão. A seção 6 examina o Coda e a seção 7 compara com trabalhos relacionados.

O gerenciador de sessão mantém dois conjuntos: os WIDs das escritas da sessão (write-set) e das escritas relevantes para as leituras (read-set). Antes de cada operação, ele procura um servidor cujo banco contenha o conjunto necessário, ou informa que a garantia não pode ser cumprida. A Tabela 1 diz qual operação atualiza e qual verifica o estado: RYW atualiza na escrita e verifica na leitura, MR atualiza e verifica na leitura, WFR atualiza na leitura e verifica na escrita, MW atualiza e verifica na escrita.

## Resultados

São as afirmações do artigo; não há medições.

- **Vetores de versão deixam o estado pequeno.** Um vetor de versão é uma lista de pares servidor e relógio, e um par serve como WID. Um conjunto de WIDs vira um vetor, a união vira o máximo por servidor e o teste de subconjunto vira dominância. O estado de uma sessão inteira se compacta em dois vetores, e a Figura 1 mostra os procedimentos de leitura e escrita em poucas linhas.
- **Duas restrições aos servidores são necessárias para as garantias de escrita.** C1: uma escrita nova é ordenada depois das que o servidor já conhece. C2: a anti-entropia que propaga W2 também propaga toda escrita ordenada antes dela. O artigo diz que o Coda cumpre C2 e o Grapevine não, porque propaga atualizações por e-mail, que pode reordenar mensagens.
- **As verificações podem ser baratas.** Elas podem ser puladas enquanto a sessão fica no mesmo servidor, e vetores de servidores guardados em cache são limites inferiores seguros. O servidor pode devolver o vetor atual inteiro como estimativa grosseira das escritas relevantes, o que é correto, porém conservador.
- **Monotonic Writes não é implicada pelas outras.** Em uma sessão W1 R W2, uma escrita alheia Wx pode sobrescrever W1, que então falta nas escritas relevantes de R, e a ordenação se perde.
- **O Coda só precisa de mudanças no cliente** para Read Your Writes e Monotonic Reads, pois seus servidores já exportam vetores de versão.
- **A disponibilidade é o custo declarado.** O artigo espera impacto pequeno, em especial com cache local, mas não apresenta dados.

## Análise crítica

As definições são precisas e os exemplos bem escolhidos, e descrevem anomalias que engenheiros ainda encontram. Os limites são do próprio artigo.

- **Sem avaliação.** Não há benchmarks, simulações nem traços de execução. A implementação no Bayou é descrita como "em andamento", e o efeito na disponibilidade é uma expectativa.
- **Por sessão, não global.** As garantias restringem a visão de uma aplicação. Não dão atualizações atômicas de várias escritas, serializabilidade nem isolamento entre aplicações concorrentes, que o artigo chama de questões ortogonais. O tratamento de conflitos também fica em aberto.
- **Custos que o próprio artigo aponta.** Uma garantia pode tornar alguns servidores inutilizáveis, e a operação pode falhar; uma aplicação sem garantias pode encher um cache compartilhado do cliente com dados antigos que outra aplicação, mais exigente, não pode ler. Sessões que sobrevivem a logouts exigem estado de sessão durável.
- **O conjunto não é dado como completo,** e RelevantWrites é difícil de calcular para consultas ricas, daí a alternativa grosseira do vetor inteiro.
- **Literatura posterior (não lida para esta entrada; baseada nas análises do catálogo).** O [ensaio de Vogels](/papers/eventually-consistent-vogels) lista read-your-writes, sessão, monotonic reads e monotonic writes como modelos de consistência do lado do cliente. A análise de [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) classifica Writes Follow Reads, Monotonic Reads e Monotonic Writes como altamente disponíveis e Read Your Writes apenas como "sticky available". A análise do [COPS](/papers/dont-settle-for-eventual-scalable-causal-consistency-cops) observa que sistemas anteriores, como o Bayou, eram na verdade causais+ mas não escaláveis. Não verifiquei o quanto esses trabalhos dependem deste.

## Pesquisas futuras

- Medir o custo em disponibilidade sob partições, entrada e saída de servidores e sessões realistas, o que o artigo deixa em aberto.
- Formas mais baratas de nomear as escritas relevantes de consultas complexas do que devolver o vetor inteiro.
- Garantias de sessão combinadas com tipos de dados convergentes como os [CRDTs](/papers/conflict-free-replicated-data-types), em que a resolução de conflitos faz parte do objeto.
- Enquadramentos de trade-off, como o [PACELC](/papers/consistency-tradeoffs-in-modern-distributed-database-system-design), que põem o preço em latência e disponibilidade de cada garantia em uma mesma escala.
- Garantias entre vários serviços, e não em um único armazenamento, como no [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications) (trabalho posterior cuja entrada no catálogo diz que sua operação wait precisa oferecer ao menos monotonic reads).
