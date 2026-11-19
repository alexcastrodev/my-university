---
title: "Read Copy Update"
summary: McKenney e cinco coautores descrevem o read-copy update (RCU), em que leitores de uma estrutura compartilhada não usam locks e o escritor só libera a versão antiga depois de um período de graça, e comparam sete implementações no Linux por overhead ocioso, latência de call_rcu() sob o dbench e tamanho do patch.
researchArea: Sistemas operacionais
keywords: read-copy update, RCU, período de graça, estado quiescente, leitores sem lock, kernel Linux, call_rcu, ordenação de memória
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O read-copy update é um mecanismo para construir algoritmos altamente escaláveis de acesso e modificação de estruturas de dados com muita leitura e pouca escrita, evitando o ping-pong de linhas de cache, a contenção de memória e os deadlocks que afligem implementações escaláveis de sistemas operacionais. Em particular, o código que só lê pode ser escrito sem locks, sem instruções atômicas e sem escritas em linhas de cache compartilhadas, mesmo com atualizações concorrentes. Os autores relataram o mecanismo básico no ano anterior e produziram vários patches para Linux que o implementam e o exploram. O artigo avalia o desempenho de várias implementações de read-copy update para kernels Linux não preemptivos e esboça uma nova implementação voltada a kernels preemptivos.

## Visão geral

O artigo foi apresentado no Ottawa Linux Symposium, de 26 a 29 de junho de 2002 (páginas 338-367 dos anais). Os autores são Paul E. McKenney, Dipankar Sarma, Andrea Arcangeli, Andi Kleen, Orran Krieger e Rusty Russell, da IBM, da SuSE Labs e da IBM Research. É a continuação de um artigo do OLS 2001 sobre o mecanismo básico, então pressupõe a ideia e gasta as páginas em como construí-la nos kernels Linux 2.4 e 2.5. O título no PDF é "Read Copy Update", sem hífen. O artigo não tem DOI.

O problema é uma estrutura lida com muita frequência e alterada raramente, como um cache de rotas ou uma lista de módulos carregados. Um lock de leitor e escritor deixa os leitores rodarem em paralelo, mas cada leitor ainda escreve na palavra do lock, e a linha de cache fica pulando entre CPUs. A resposta do artigo é deixar os leitores rodarem sem lock nenhum e empurrar o custo da segurança para o escritor. Para outra visão do que limita o código do kernel em muitos núcleos, veja [Analysis of Linux Scalability](/papers/analysis-of-linux-scalability-to-many-cores), que inclui entre suas correções um protocolo sem lock com contador de geração para comparar dentries. O [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) usa RCU na travessia sem lock da tabela de páginas.

Termos: estado quiescente é um ponto em que todas as variáveis temporárias de uma CPU (ponteiros usados ao percorrer uma estrutura) de antes de certo instante estão mortas. Período de graça é um intervalo em que toda CPU passa por ao menos um estado quiescente. Vale saber antes: spin locks, troca de contexto, dados por CPU e coerência de cache.

## Contribuição

- **A disciplina de atualização em duas fases.** O escritor primeiro remove todo ponteiro permanente para o item, depois espera um período de graça e só então o libera. Buscas iniciadas antes da primeira fase ainda podem ver o item, buscas iniciadas depois não podem, e a espera cobre as primeiras.
- **Uma API.** `synchronize_kernel()` bloqueia por um período de graça completo e não pode ser chamada com locks adquiridos nem em contexto de BH ou IRQ. `call_rcu()` agenda uma função para rodar depois de um período de graça e nunca dorme. O idioma usual troca `kfree()` por um `call_rcu()` de um wrapper dela.
- **Estados quiescentes inferidos, não cronometrados.** O período de graça não tem duração fixa. Threads do kernel não podem segurar locks atravessando uma troca de contexto, logo também não seguram ponteiros para os dados protegidos, e uma troca de contexto em uma CPU é um estado quiescente. Quando todas as CPUs trocaram de contexto, o item pode ser liberado.
- **Um espaço de projeto e sete implementações.** Agrupamento em lotes, como se deduz o fim do período, mecanismo de polling, fila de requisições, definição de estado quiescente e contextos permitidos são os parâmetros. A Tabela 1 lista X-rcu, rcu, rcu-poll, rcu-ltimer, rcu-taskq, rcu-sched e rcu-preempt.
- **Aplicações.** Um patch para o cache de rotas IP do Linux, um patch de uma linha que espera um período de graça antes de `free_module()` liberar a estrutura de um módulo, e uma nota sobre ordenação de memória na inserção sem lock.
- **Uma variante preemptiva.** O rcu-preempt rastreia, por CPU, as tarefas que foram preemptadas e conta apenas trocas de contexto voluntárias como estados quiescentes.

## Metodologia

O artigo é um relato de implementação e medição. Cada variante é descrita com o código de `call_rcu()`, o gancho no escalonador e o processamento por timer ou tasklet, e comparada em três eixos: overhead ocioso (Tabela 2), latência de `call_rcu()` sob o benchmark dbench em uma máquina de 8 CPUs Pentium III Xeon de 700MHz com caches L2 de 1MB e 6GB de memória, usando o patch dcache-rcu (Figuras 9 e 10), e tamanho do patch em linhas de diff unificado (Tabela 3). Um benchmark de chat com 20 salas e 500 mensagens em uma máquina de 4 CPUs com 1GB testa se a latência maior custa vazão (Figura 11). O resultado do cache de rotas usa a mesma máquina de 8 CPUs, com uma carga que envia um número fixo de pacotes IP de tamanho aleatório a um único destino.

## Resultados

- **Cache de rotas.** Depois do patch, o overhead de `ip_route_output_key()` cai na Figura 6 (cerca de 12.000 ticks de profile no kernel base contra cerca de 5.500 com RCU em 8 CPUs, lidos no gráfico). A Figura 7 mostra os ticks totais não ociosos do kernel, então o ganho não vem à custa de outro trabalho. Os autores chamam o ganho geral de bem pequeno, porque a mudança foi feita para validar as implementações e não para resolver um problema conhecido. Citam 30% para a gestão de FDs e 25% para a gestão do dcache, de outros trabalhos.
- **Overhead ocioso.** O rcu-taskq não tem nenhum. O rcu-poll e o rcu-preempt somam um incremento local não atômico no escalonador. Os demais pagam overhead de timer quando ociosos.
- **Latência.** O rcu-poll mantém a latência de `call_rcu()` abaixo de 10 milissegundos sob o dbench, e abaixo de 250 microssegundos em sistema ocioso. X-rcu, rcu-ltimer e rcu têm latências maiores, mas limitadas. A do rcu-taskq cresce com o número de clientes. O rcu-sched mostrou 14,5 segundos com 8 clientes e 57,7 segundos com 4 clientes, e os autores dizem estar investigando.
- **Benchmark de chat.** Os resultados mostram pouca sensibilidade ao algoritmo.
- **Complexidade.** Os patches vão de 237 linhas (rcu-taskq) a 742 (rcu-ltimer, das quais 514 são para uma arquitetura), com o rcu-sched em 575 e 333 e o rcu-preempt em 682.
- **Conclusões.** rcu-poll para cargas com poucos `call_rcu()`, as variantes de latência maior para taxas altas, com medições sob carga pesada de `call_rcu()` ainda por fazer.
- **Ordenação de memória.** A inserção exige `wmb()` no escritor e, em Alpha, os leitores precisam de `rmb()` entre buscar um ponteiro e desreferenciá-lo. Foi proposto um `read_barrier_depends()` para poupar as outras CPUs desse custo.

## Análise crítica

O artigo é um retrato de patches de 2002 e diz isso. A afirmação de que leitores não precisam de locks, atômicas nem escritas compartilhadas vale só para leituras: os escritores ainda usam um spin lock para serializar as atualizações (Figura 4). O custo aparece como memória retida até o fim do período de graça, que o artigo nomeia como a principal figura de mérito, mas não dimensiona em bytes.

Alguns pontos são frágeis. A comparação com outros mecanismos de atualização concorrente é delegada a outros artigos, então aqui não há confronto direto com locks de leitor e escritor além do cache de rotas antes e depois. O texto diz que o rcu-sched não usa locks, mascaramento de interrupções, barreiras de memória nem instruções atômicas, mas o `call_rcu()` dele na Figura 28 executa `atomic_inc(&rcu_pending)` e a Tabela 2 lista uma leitura global. As latências do rcu-sched ficam sem explicação, e o benchmark de chat mistura vários patches. O patch de módulos declaradamente não fecha todas as corridas de descarregamento.

Literatura posterior, não lida aqui, com apenas os metadados conferidos: a documentação do kernel Linux (docs.kernel.org, "What is RCU?") lista uma API de cinco chamadas (`rcu_read_lock()`, `rcu_read_unlock()`, `synchronize_rcu()` ou `call_rcu()`, `rcu_assign_pointer()`, `rcu_dereference()`), suporta leitores RCU preemptíveis e diz que leitores que precisam bloquear exigem SRCU. Nada disso está neste artigo. Alglave, Maranget, McKenney, Parri e Stern, "Frightening Small Children and Disconcerting Grown-ups: Concurrency in the Linux Kernel" (ASPLOS 2018), e Gotsman, Rinetzky e Yang, "Verifying Concurrent Memory Reclamation Algorithms with Grace" (ESOP 2013), pertencem à linha de semântica formal que veio depois.

## Pesquisas futuras

- **Preempção.** Os autores planejam adaptar mais implementações a kernels preemptíveis e escolher a melhor para o 2.5.
- **Mais cargas.** Medições sob carga pesada de `call_rcu()` e em outros benchmarks, incluindo o cache de rotas em cargas que o estressem.
- **Uma correção completa do descarregamento de módulos.** O patch de uma linha serve de base para uma solução completa.
- **Primitivas de ordenação.** Trocar `rmb()` por `read_barrier_depends()`. Para bugs do kernel causados por barreiras ausentes, veja o [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs).
- **Reuso de memória.** Objetos liberados voltam a um alocador do kernel, veja [The Slab Allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator), e o período de graça atrasa esse reuso.
- **Trabalhos de sistemas posteriores.** O [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) e Clements, Kaashoek e Zeldovich, "Scalable address spaces using RCU balanced trees" (ASPLOS 2012, não lido).
