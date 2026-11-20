---
title: "IronFleet: provando a correção de sistemas distribuídos práticos"
summary: O IronFleet verifica as implementações de dois sistemas distribuídos, uma biblioteca de máquina de estados replicada baseada em Paxos e um armazenamento chave-valor fragmentado, encadeando refinamento no estilo TLA, de uma especificação curta até o protocolo, e provas de Floyd-Hoare em Dafny, do protocolo até o código, e prova vivacidade além de segurança. O custo é de 3,7 pessoas-ano e uma base confiável que os autores listam.
researchArea: Sistemas distribuídos
keywords: verificação formal, refinamento, Dafny, TLA, redução, vivacidade, Paxos, máquina de estados replicada, armazenamento chave-valor
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Sistemas distribuídos são conhecidos por abrigar bugs sutis. Em princípio, a verificação pode eliminá-los a priori, mas ela sempre foi difícil de aplicar na escala de um programa completo, quanto mais na de um sistema distribuído. Os autores descrevem uma metodologia para construir sistemas distribuídos práticos e comprovadamente corretos, baseada numa combinação singular de refinamento de máquinas de estados no estilo TLA e verificação em lógica de Hoare. Demonstram a metodologia numa implementação complexa de uma biblioteca de máquina de estados replicada baseada em Paxos e de um armazenamento chave-valor fragmentado baseado em leases. Provam que cada um obedece a uma especificação de segurança concisa e a requisitos desejáveis de vivacidade. Cada implementação alcança desempenho competitivo com um sistema de referência. Com a metodologia e as lições aprendidas, o objetivo é elevar o padrão dos sistemas distribuídos de "testado" para "correto".

## Visão geral

A maior parte do trabalho formal em sistemas distribuídos termina no protocolo: provar que o Paxos é seguro não diz nada sobre o código escrito a partir dele. O artigo (SOSP 2015, Microsoft Research) ataca essa lacuna. Segundo os autores, as provas de protocolo raramente chegam à implementação, e o model checking é incompleto e não escala. Implementações reais acrescentam o que os artigos de protocolo omitem, como truncamento de log, batching, transferência de estado, inteiros limitados e análise de pacotes, e é aí que os bugs sutis moram.

O catálogo já tem os vizinhos. [Paxos Made Simple](/papers/paxos-made-simple) descreve o algoritmo que o IronRSL implementa (o artigo cita o original, [The Part-Time Parliament](/papers/paxos-part-time-parliament), para o Paxos). [Raft](/papers/raft-understandable-consensus-algorithm), [Zab](/papers/zab-high-performance-broadcast-primary-backup-systems), [Egalitarian Paxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments) e [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) aparecem nos trabalhos relacionados como protocolos com provas em papel; a base de comparação não verificada é o Multi-Paxos do código do EPaxos. [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) são o tipo de serviço em que, segundo o artigo, um bug de replicação se propaga em cascata, e o [FLP](/papers/flp-impossibility-of-distributed-consensus) é o motivo de o teorema de vivacidade exigir hipóteses de temporização. Do lado dos sistemas, o artigo cita o [seL4](/papers/sel4-formal-verification-of-an-os-kernel) como código verificado de uma única máquina; o IronFleet é distribuído e também prova vivacidade.

Vale conhecer antes: refinamento de máquinas de estados, lógica de Hoare com pré e pós-condições, o que um solucionador SMT como o Z3 decide e não decide, e a diferença entre segurança e vivacidade.

## Contribuição

- **Refinamento em camadas.** Uma especificação de alto nível confiável (uma máquina de estados), uma camada de protocolo distribuído não confiável e uma implementação imperativa. Prova-se que o protocolo refina a especificação no estilo TLA e que a implementação refina o protocolo com raciocínio de Floyd-Hoare, tudo em Dafny, então não surge lacuna semântica entre as camadas.
- **Contenção da concorrência.** As provas supõem que cada passo de um host é atômico. Um argumento de redução (o artigo cita a redução de Lipton, de 1975) justifica isso, porque a implementação precisa fazer todos os receives antes de todos os sends em cada passo. O Dafny impõe essa obrigação; o argumento de que ela basta é um esboço em papel, não verificado por máquina.
- **Vivacidade em Dafny.** Uma incorporação de TLA com 40 regras de prova verificadas e protocolos construídos com ações sempre habilitadas, o que facilita estabelecer justiça (fairness).
- **Dois sistemas verificados.** O IronRSL (máquina de estados replicada em Multi-Paxos, com batching, truncamento de log, transferência de estado, timeouts dinâmicos de troca de visão e cache de respostas) e o IronKV (uma tabela hash fragmentada).
- **Bibliotecas reutilizáveis e lições,** como marshalling e parsing verificados e o "ocultamento de quantificadores em invariantes".

## Metodologia

A especificação são três predicados (SpecInit, SpecNext, SpecRelation): 85 linhas no IronRSL, cuja propriedade é a linearizabilidade, e 34 no IronKV, uma tabela hash simples. A camada de protocolo tem N hosts e uma rede, cada passo atômico, escrita de forma declarativa com inteiros ilimitados e pacotes abstratos. O refinamento é provado com uma função de refinamento e invariantes indutivos. A implementação usa uint64, arrays mutáveis e pacotes UDP em bytes, e um laço principal que todo host é obrigado a executar (Figura 8 do artigo).

O Dafny compila para C#, e o compilador .NET gera o executável. O Z3 resolve a maior parte dos passos de prova de baixo nível. Os autores usam os atributos opaque e reveal, fuel e gatilhos manuais para evitar timeouts do Z3, e constroem as implementações primeiro com tipos funcionais e depois com tipos mutáveis de heap.

A avaliação compara cada sistema com um não verificado: o IronRSL contra o Multi-Paxos do código do EPaxos em três máquinas (Xeon L5630, 1 Gbps), e o IronKV contra o Redis em duas máquinas (10 Gbps).

## Resultados

- **Propriedades provadas.** IronRSL: correção funcional completa (linearizabilidade) e vivacidade: se um cliente envia uma requisição repetidamente a todas as réplicas, ele eventualmente recebe uma resposta, supondo um quórum vivo, frequência mínima do escalonador, atraso de rede e tamanho de rajada limitados, erro de relógio limitado e nenhuma parada por limite de overflow. IronKV: correção funcional e uma propriedade de vivacidade do componente de transmissão confiável: numa rede justa, todo pacote submetido é eventualmente recebido.
- **Esforço (Figura 12).** 1.400 linhas de especificação, 5.114 de implementação e 39.253 de prova. Na camada de implementação, a razão entre anotações de prova e código executável é de 3,6 para 1. Desenvolver a metodologia e verificar os dois sistemas levou aproximadamente 3,7 pessoas-ano.
- **Tempo de verificação.** 395 minutos no total; um build completo serial leva cerca de seis horas e, com máquinas em nuvem em paralelo, o desenvolvedor raramente espera mais de 6 a 8 minutos. O retorno da IDE por método leva de 1 a 10 segundos.
- **Desempenho.** O throughput de pico do IronRSL fica a até 2,4 vezes do baseline em Multi-Paxos. O IronKV é descrito como competitivo com o Redis. A conclusão cita até 18.200 requisições por segundo (IronRSL) e 28.800 (IronKV). A CPU foi o gargalo em todos os experimentos.
- **Bugs.** Exceto por componentes não verificados, como o cliente em C#, os dois sistemas funcionaram já na primeira execução.

## Análise crítica

O que o artigo não afirma. As garantias dependem de uma base confiável declarada: o usuário precisa ler as especificações e o breve laço principal de eventos, e o Dafny, o compilador e o runtime .NET, o Windows e o hardware são tomados como corretos. A rede pode descartar, atrasar ou duplicar pacotes, mas não pode adulterá-los, e os endereços nos cabeçalhos são confiáveis. Comportamento bizantino aparece só nos trabalhos relacionados (provas do PBFT feitas por outros), e o artigo não diz nada sobre tolerá-lo. O argumento de redução não é verificado, e o artigo deixa como trabalho futuro verificá-lo, provar laço principal de tempo limitado, ausência de esgotamento de memória e de limite de overflow. A recuperação após falha (quedas que apagam a memória mas não o disco) exige técnicas novas, e o artigo diz que a reconfiguração do IronRSL só exige tempo de desenvolvimento, mas não a fez.

Outros limites. Os 3,7 pessoas-ano cobrem a metodologia e os dois sistemas juntos, então o custo de um terceiro não é informado. Os dois sistemas são mais lentos que os baselines, e os autores dizem que cada otimização precisa ser provada. O resumo chama o armazenamento chave-valor de "baseado em leases", mas o corpo descreve mapas de delegação e transmissão confiável, e a palavra "lease" não aparece em nenhum outro lugar; leio isso como um rótulo solto.

Literatura posterior, que não faz parte do texto de 2015 e que não foi relida para esta análise (só as análises deste catálogo): o [Grove](/papers/grove-separation-logic-library-for-verifying-distributed-systems) reporta um custo de prova ligeiramente acima do do IronFleet, e o [Verus](/papers/verus-practical-foundation-for-systems-verification) porta o host do IronKV de Dafny e reporta provas menores e verificação mais rápida. Do lado dos kernels, o [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) (2017) também usa o Z3, mas busca provas push-button de um kernel de uma única máquina, e o [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) (2016) vem do mesmo projeto do hipervisor mCertiKOS-hyp que o IronFleet cita. Nenhum dos dois verifica um sistema distribuído.

## Pesquisas futuras

- Uma prova verificada por máquina da obrigação de redução e de laços principais de tempo limitado.
- Reconfiguração e recuperação após falha verificadas, que segundo os autores exigem técnicas adicionais.
- Verificar C++ ou código de mais baixo nível em vez de C# gerado a partir do Dafny, para reduzir a base confiável.
- Provas mais baratas: os autores apontam melhores bibliotecas e ferramentas.
