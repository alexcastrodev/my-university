---
title: "Linearizabilidade: uma condição de correção para objetos concorrentes"
summary: A definição de linearizabilidade de Herlihy e Wing, a condição que faz cada operação sobre um objeto compartilhado parecer ter efeito instantâneo entre sua invocação e sua resposta, com provas de que ela é local e não bloqueante, uma comparação com consistência sequencial e serializabilidade e um método de prova para implementações.
researchArea: Sistemas distribuídos
keywords: linearizabilidade, objetos concorrentes, condição de correção, localidade, consistência sequencial, serializabilidade, função de abstração
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A concurrent object is a data object shared by concurrent processes. Linearizability is a correctness condition for concurrent objects that exploits the semantics of abstract data types. It permits a high degree of concurrency, yet it permits programmers to specify and reason about concurrent objects using known techniques from the sequential domain. Linearizability provides the illusion that each operation applied by concurrent processes takes effect instantaneously at some point between its invocation and its response, implying that the meaning of a concurrent object's operations can be given by pre- and post-conditions. This paper defines linearizability, compares it to other correctness conditions, presents and demonstrates a method for proving the correctness of implementations, and shows how to reason about concurrent objects, given they are linearizable.

## Visão geral

Este é o artigo que deu um significado preciso a "parece uma única cópia que atualiza de forma atômica". Ele saiu no ACM Transactions on Programming Languages and Systems em julho de 1990, depois de uma versão preliminar no ACM Symposium on Principles of Programming Languages em janeiro de 1987. O cenário é um multiprocessador de memória compartilhada, com processos sequenciais chamando operações de objetos tipados compartilhados, não uma rede de máquinas. Mesmo assim, quase todo uso posterior da palavra "linearizável" em sistemas distribuídos, de logs replicados a bancos de dados em nuvem, remete a essa definição.

O artigo fica entre duas ideias mais antigas. A consistência sequencial (Lamport) só exige que o resultado pareça uma execução sequencial qualquer. A serializabilidade, vinda dos bancos de dados, exige o mesmo para transações inteiras. A linearizabilidade acrescenta a exigência de que a ordem das operações que não se sobrepõem no tempo real seja preservada. Quem vem de sistemas distribuídos vê por que isso importa no [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases), que paga um custo de protocolo para servir leituras linearizáveis localmente, e no [Spanner](/papers/spanner-globally-distributed-database), que chama de consistência externa a sua garantia transacional. Os [relógios lógicos de Lamport](/papers/lamport-time-clocks-ordering-of-events) são um bom contraste: eles ordenam eventos por causalidade, enquanto a linearizabilidade os ordena por precedência em tempo real, que um serviço replicado construído com a [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) ou com o [Raft](/papers/raft-understandable-consensus-algorithm) precisa respeitar.

Vale conhecer antes: pré e pós-condições, o que são uma fila FIFO e um registrador de leitura e escrita, e a ideia de intercalação de passos concorrentes.

## Contribuição

- **Uma definição formal.** Um histórico é uma sequência finita de eventos de invocação e resposta. Ele é linearizável se puder ser estendido com respostas para algumas invocações pendentes de modo que, descartadas as demais, fique equivalente a um histórico sequencial legal (L1) que preserva a ordem de precedência em tempo real das operações (L2).
- **Duas propriedades estruturais, provadas.** A linearizabilidade é local (um histórico é linearizável se e somente se o subhistórico de cada objeto for) e não bloqueante (uma invocação pendente de uma operação total nunca precisa esperar por outra).
- **Uma comparação com outras condições.** Consistência sequencial e serializabilidade não são locais, e a serializabilidade é inerentemente bloqueante. O artigo mostra que a linearizabilidade é um caso especial de serializabilidade estrita em que cada transação é uma operação sobre um objeto.
- **Um método de prova para implementações.** O invariante de representação precisa valer a cada passo, e a função de abstração deve levar cada valor da representação a um conjunto não vazio de valores abstratos, não a um só valor.
- **Duas implementações novas de uma fila altamente concorrente,** usadas para mostrar o método em código sem exclusão mútua e depois em uma variante com seções críticas que usa dados auxiliares.
- **Raciocínio sobre os clientes.** Só com os axiomas sequenciais e a linearizabilidade, o artigo prova propriedades de registradores e filas.

## Metodologia

O artigo é um desenvolvimento formal com exemplos trabalhados, não um experimento. A Seção 2 define históricos, boa formação (cada subhistórico de processo é sequencial), especificações sequenciais (conjuntos de históricos sequenciais fechados por prefixo, escritos no estilo axiomático do Larch) e a ordem de precedência induzida por um histórico. Figuras mostram quatro históricos de fila FIFO e dois de registrador para separar o comportamento aceitável do inaceitável antes de o formalismo aparecer.

A Seção 3 prova os dois teoremas e constrói contraexemplos: o histórico H8 sobre duas filas p e q é sequencialmente consistente em cada objeto, mas não como um todo. A Seção 4 define quando uma implementação é correta (todo histórico restrito ao objeto abstrato é linearizável) e introduz os valores linearizados, o conjunto Lin(H) dos valores do objeto ao fim das linearizações possíveis de H. A obrigação de prova é que, para todo valor linearizado r do histórico da representação, valha I(r) e A(r) seja subconjunto de Lin do histórico abstrato. Um apêndice dá quatro axiomas genéricos (C, I, R e S) sobre "possibilidades" e afirma que eles são corretos e completos.

## Resultados

Todos os resultados são provados no artigo, não medidos.

- **Localidade (Teorema 1).** Um sistema de objetos linearizáveis é linearizável, então os objetos podem ser implementados e verificados de forma independente, e o escalonamento não precisa de coordenação global.
- **Não bloqueio (Teorema 2).** Para uma operação total, qualquer histórico linearizável com uma invocação pendente pode ser completado com alguma resposta e continuar linearizável. Uma operação parcial, como retirar de uma fila vazia, ainda pode esperar, e isso é uma escolha da especificação.
- **Condições mais fracas falham na localidade.** A consistência sequencial não é local (H8), e nem a serializabilidade nem a serializabilidade estrita são locais. A serializabilidade também pode forçar uma transação a recuar mesmo com operações totais (histórico H9, com dois registradores e duas transações).
- **A função de abstração de um único passo não funciona.** Para a fila implementada com INC, STORE, READ e SWAP sobre um arranjo infinito, nenhuma função que escolha um valor abstrato por valor de representação é consistente com todos os futuros. A ordem de dois enfileiramentos concorrentes depende de uma corrida com um desenfileiramento posterior, então a função de abstração precisa devolver um conjunto de valores.
- **Propriedades dos objetos linearizáveis.** Todo valor lido de um registrador foi escrito e não sobrescrito (Teorema 3), e leituras dentro de um intervalo sem escrita sobreposta devolvem o mesmo valor (Teorema 4). Para filas, se dois enfileiramentos são ordenados, os desenfileiramentos não podem se inverter (Teorema 6), e itens nem somem (Teorema 7) nem surgem do nada (Teorema 8). O artigo observa que o Teorema 6 sozinho, usado como especificação por Gottlieb, Lubachevsky e Rudolph, é incompleto sem os outros dois.

## Análise crítica

O artigo cumpre o que promete: uma definição curta o bastante para ser lembrada (L1 e L2) e forte o bastante para provar teoremas úteis. Os limites têm mais a ver com o escopo.

- **Sem evidência de desempenho.** A fila é dita muito mais eficiente e concorrente do que versões baseadas em bloqueio de duas fases ou em timestamps multiversão, mas a afirmação é argumentada, não medida.
- **Falhas ficam fora do modelo.** Os processos são sequenciais e nada quebra; o artigo diz que não há equivalente de atomicidade de falhas para a linearizabilidade. Usá-la em um serviço replicado exige acrescentar um modelo de falhas que o artigo não traz.
- **Só segurança.** O artigo diz que a linearizabilidade é uma propriedade de segurança e que vivacidade, como justiça, exige outras ferramentas, como a lógica temporal.
- **Esforço de prova.** O método pede um invariante, uma função de abstração com valores em conjuntos e às vezes variáveis auxiliares, e o apêndice só esboça a prova completa, com os detalhes em um relatório à parte. Verificar uma implementação real assim dá muito trabalho.
- **O tempo real é assumido, não definido.** A precedência é "resposta antes da invocação", então o modelo nunca diz como um sistema fica sabendo disso, que é o problema prático das implementações distribuídas.

## Pesquisas futuras

O artigo é a base de uma grande linha de trabalhos, e estas direções decorrem dele.

- Implementações sem espera e sem bloqueio de objetos linearizáveis, que o artigo diz serem discutidas em outro lugar.
- Variáveis de profecia, que segundo o artigo foram inspiradas pelo seu exemplo da fila (Abadi e Lamport), e provas por refinamento em geral.
- Teste e verificação: registrar um histórico e procurar uma linearização, como fazem verificadores modernos usados em bancos de dados e filas.
- Relaxamentos que mantêm parte da garantia, como consistência sequencial, consistência causal e linearizabilidade por chave, e seu custo em latência.
- Linearizabilidade em serviços replicados e geodistribuídos, em que a ordem em tempo real precisa ser imposta com consenso, leases ou relógios sincronizados, como nos artigos ligados acima.
