---
title: "Verdi: um framework para implementar e verificar formalmente sistemas distribuídos"
summary: O Verdi é um framework em Coq em que um sistema distribuído é verificado primeiro sob uma rede idealizada e depois levado, por transformadores de sistema verificados, a semânticas com reordenação, duplicação, perdas e falhas de nós, com um armazenamento chave-valor, um transformador primário-backup e um armazenamento replicado sobre Raft (vard) como estudos de caso.
researchArea: Sistemas distribuídos
keywords: verificação formal, Coq, semânticas de rede, transformadores de sistema verificados, replicação de máquina de estados, Raft, linearizabilidade, extração para OCaml
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Sistemas distribuídos são difíceis de implementar corretamente porque precisam lidar ao mesmo tempo com concorrência e com falhas: máquinas podem falhar em qualquer ponto e as redes podem reordenar, perder ou duplicar pacotes. Além disso, o comportamento desses sistemas costuma ser complexo demais para um teste exaustivo. Bugs nesses sistemas já causaram perda de dados críticos e interrupções inaceitáveis de serviço. Apresentamos o Verdi, um framework para implementar e verificar formalmente sistemas distribuídos em Coq. O Verdi formaliza várias semânticas de rede com falhas diferentes, e o desenvolvedor escolhe o modelo de falhas mais adequado ao verificar sua implementação. Além disso, o Verdi reduz o custo da verificação: o desenvolvedor verifica primeiro o sistema sob um modelo de falhas idealizado e depois transfere as garantias de correção para um modelo mais realista, sem esforço adicional de prova. Para demonstrar a utilidade do Verdi, apresentamos a primeira prova verificada mecanicamente de linearizabilidade do algoritmo de replicação de máquina de estados Raft, além de implementações verificadas de um sistema de replicação primário-backup e de um armazenamento chave-valor. Esses sistemas verificados têm desempenho semelhante ao de equivalentes não verificados.

## Visão geral

A maior parte do trabalho formal sobre sistemas distribuídos verifica um protocolo abstrato (TLA, Alloy), enquanto as implementações reais "muitas vezes divergem de maneiras importantes das suas descrições de alto nível", ponto que os autores tomam de [Paxos Made Live](/papers/paxos-made-live-engineering-perspective). O Verdi (PLDI 2015, Universidade de Washington) verifica, em vez disso, código que funciona. O artigo abre com a queda do Amazon EC2 em abril de 2011, causada por uma falha na recuperação de falhas, e cita [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) entre suas fontes sobre perda de dados e interrupções de serviço. Comparado ao [seL4](/papers/sel4-formal-verification-of-an-os-kernel), que verifica uma única máquina, aqui a dificuldade é que o ambiente se comporta mal: o programa verificado precisa estar correto sob qualquer rede que a implantação possa produzir.

Conhecimentos úteis: o [Raft](/papers/raft-understandable-consensus-algorithm) e sua [tese](/papers/consensus-bridging-theory-and-practice-raft-thesis), a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects), a replicação de máquina de estados e o assistente de provas Coq. O artigo se limita a propriedades de segurança (safety). Vivacidade (liveness) fica para trabalho futuro.

## Contribuição

- **Uma cadeia de ferramentas em Coq sem lacuna de formalidade.** O programador escreve quatro definições em Coq (nomes dos nós, entradas, saídas e mensagens, estado de cada nó, handlers), prova a especificação e extrai OCaml que é ligado a um shim em OCaml.
- **Semânticas de rede como parâmetro.** Relações de passo pequeno para rede de nó único, com reordenação, com duplicação, com perdas e com falhas de nós, cada uma parametrizada pelos tipos e handlers do próprio sistema.
- **Transformadores de sistema verificados (VSTs).** Uma função que leva um sistema a um novo sistema para outra semântica, com a prova de que as propriedades se transferem por uma função `transfer`. Os transformadores de transmissão mantêm o conjunto de nós (numeração de sequência); os de replicação acrescentam cópias de nós (primário-backup, Raft). Um transformador de variáveis fantasma (ghost) adiciona estado só para a prova, sem custo de prova.
- **Estudos de caso:** um armazenamento chave-valor, um transformador primário-backup e um transformador de consenso sobre Raft com prova de linearizabilidade, além do armazenamento composto vard.

## Metodologia

Um trace é a sequência de entradas e saídas externas. Um sistema satisfaz uma especificação se ela vale em todo trace que a semântica permite. O exemplo corrente é um serviço de lock cuja propriedade é a exclusão mútua. Na semântica com reordenação (pacotes chegam exatamente uma vez, em qualquer ordem, e nós nunca falham) a prova tem três passos: um invariante indutivo sobre os estados dos nós e os pacotes em trânsito, uma relação entre estados e traces, e a combinação dos dois. O invariante consumiu cerca de 500 linhas de Coq.

A semântica com perdas acrescenta uma regra DROP e uma regra TIMEOUT (um timeout pode disparar em qualquer passo, o tempo não é modelado), e a semântica com falhas acrescenta CRASH e REBOOT, em que um handler de reboot decide qual estado sobrevive. Um transformador é um invólucro em volta de estado, mensagens e handlers, de modo que os handlers internos não distinguem em qual semântica rodam. O transformador de numeração de sequência marca as mensagens e descarta os pares já vistos. Sua prova é uma simulação regressiva: todo passo do sistema transformado, com os duplicados removidos da rede, corresponde a um passo do sistema original, demonstrado por indução.

No primário-backup, o primário enfileira as entradas e as replica uma a uma, respondendo só depois que o backup confirma. Os traces do primário são traces do sistema original, e o backup é igual ao primário ou está um passo à frente. O Raft é implementado como um conjunto de RPCs, cada uma um par de mensagens (AppendEntries, RequestVote), sem compactação de log nem mudança de membros. A linearizabilidade é provada a partir da state machine safety do Raft, já que o log guarda uma ordem linearizada.

## Resultados

- **Esforço (Tabela 2, linhas com brancos e comentários, spec / impl / prova).** Numeração de sequência 20 / 89 / 576; armazenamento chave-valor 41 / 138 / 337 (o texto fala em cerca de 280 linhas para essa prova); primário-backup 20 / 134 / 1155; linearizabilidade do Raft 170 / 520 / 4144; o próprio Verdi (shim, semânticas, lemas comuns) 148 / 220 / 2364. Aplicar o transformador primário-backup ao armazenamento custa 5 linhas de spec e 19 de prova.
- **Bugs achados durante a prova.** Os autores encontraram vários erros graves nas próprias implementações. O mais sutil estava no Raft deles: servidores podiam apagar entradas confirmadas após uma sequência complexa de falhas, que um teste comum dificilmente alcançaria.
- **Verificação funcional.** Em um cluster de três nós, eles mataram o líder do vard e o sistema voltou como esperado.
- **Desempenho (Tabela 3).** Três nós com oito núcleos Xeon de 2,0 GHz, 8 GB e discos de 7200 RPM, em um switch gigabit. Um nó separado enviou 100 requisições aleatórias de get ou put, com 8 threads, sobre 50 chaves. O etcd chegou a 38,9 req/s, com latência de 205 ms no get e 198 ms no put. O vard, a extração para OCaml do armazenamento composto, chegou a 34,3 req/s, com 232 ms e 232 ms. Os autores atribuem a vantagem do etcd a melhores estruturas de dados e a agrupamento de requisições, observam que o vard não tem todas as funcionalidades e concluem que o desempenho é aproximadamente equivalente.

## Análise crítica

O artigo declara a sua base confiável: as especificações, a suposição de que as semânticas de rede correspondem à rede física, o shim do Verdi, o verificador de provas e o extrator de código do Coq, e o compilador e o runtime do OCaml. Ele prova apenas segurança, sem vivacidade, e nenhuma semântica modela comportamento bizantino. As semânticas tratam entradas e pacotes como tipos abstratos, então estado de conexão e bits no fio não são modelados. O Raft não tem compactação de log nem mudança de membros.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **O resultado do Raft é condicional.** O abstract afirma a primeira prova verificada mecanicamente de linearizabilidade do Raft, mas as Seções 7 e 7.2 dizem que a state machine safety, da qual a linearizabilidade decorre, ainda estava em andamento. O que está verificado é a implicação de state machine safety para linearizabilidade, e as 4144 linhas de prova da Tabela 2 são dessa implicação.
- **O benchmark é pequeno.** 100 requisições, 50 chaves, sem variância reportada, e uma versão do etcd não especificada além de uma referência de 2014. Cerca de 12% menos vazão e 13% (get) a 17% (put) mais latência (conta minha a partir da Tabela 3) dizem pouco sobre o custo em regime estável.
- **Estado do invólucro sem limite (minha leitura da Figura 10).** O transformador de numeração guarda todo par (remetente, número) já visto, então o estado só cresce.
- **A falha do primário é manual.** O primário-backup é verificado na semântica com reordenação, então uma queda exige intervenção manual, como o próprio artigo diz.
- **Literatura posterior, fora do texto de 2015.** O Crossref lista "Planning for change in a formal verification of the Raft consensus protocol" (Woos, Wilcox, Anton, Tatlock, Ernst, Anderson, CPP 2016, pp. 154-165); conferi só título, autores e venue, e não li. A nota da tese do Raft neste catálogo também diz que o time do Verdi concluiu uma prova em Coq do Raft básico, o que é afirmação dessa nota, não algo que eu tenha verificado.

## Pesquisas futuras

- Vivacidade, que os autores propõem tratar com traces infinitos e axiomas de justiça (fairness) como no TLA, e modelos de falhas bizantinas, acrescentando não determinismo às semânticas.
- Semânticas de rede de mais baixo nível ligadas por transformadores, o que reduziria a base confiável, e um shim verificado.
- Extensões do Raft deixadas de fora: compactação de log e mudança de membros.
- Outras abordagens para verificar implementações distribuídas neste catálogo: o [IronFleet](/papers/ironfleet-proving-practical-distributed-systems-correct) verifica uma biblioteca baseada em Paxos e um armazenamento chave-valor em Dafny, e a nota do catálogo diz que ele prova vivacidade além de segurança (li só essa nota, não o artigo do IronFleet; o artigo do Verdi não o cita). O [Grove](/papers/grove-separation-logic-library-for-verifying-distributed-systems) usa lógica de separação para cobrir falhas, redes com perda e leases baseados em tempo (nota do catálogo, pareamento meu).
- Verificar a máquina sob o programa: [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) e [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) verificam kernels, então pilhas de ponta a ponta, do protocolo de rede ao hardware, ainda não se juntam nos artigos do catálogo (minha leitura).
