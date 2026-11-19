---
title: "O alocador slab: um alocador de memória de kernel com cache de objetos"
summary: Bonwick descreve o alocador de memória do kernel do SunOS 5.4, em que os clientes registram um construtor e um destrutor e os objetos liberados ficam guardados já construídos, de modo que alocar dispensa o custo de inicialização. A memória é dividida em slabs com contador de referências, devolvida sob pressão de memória e deslocada por uma "cor" em cada slab para espalhar os buffers pelo cache de hardware.
researchArea: Sistemas operacionais
keywords: alocador slab, cache de objetos, alocação de memória no kernel, estado construído, coloração de cache, recuperação de memória, fragmentação
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo apresenta uma visão geral completa do projeto do alocador de memória do kernel do SunOS 5.4. O alocador se baseia em um conjunto de primitivas de cache de objetos que reduzem o custo de alocar objetos complexos ao reter o estado deles entre os usos. As mesmas primitivas se mostram igualmente eficazes para gerenciar memória sem estado (por exemplo, páginas de dados e buffers temporários), porque são rápidas e econômicas em espaço. Os caches de objetos respondem dinamicamente à pressão global de memória e usam um esquema de coloração de objetos que melhora a utilização do cache e o equilíbrio dos barramentos do sistema. O alocador também tem vários recursos estatísticos e de depuração capazes de detectar uma ampla variedade de problemas no sistema.

## Visão geral

Um kernel aloca e libera estruturas pequenas o tempo todo: inodes, stream heads, blocos de mensagem, mapas de endereços. A observação de partida de Bonwick é que, para muitas delas, inicializar e destruir o objeto custa mais do que obter a memória, ainda mais quando a estrutura contém um mutex, uma variável de condição e um contador de referências, como em kernels multithread. Um `malloc` mais rápido sozinho não elimina esse custo.

Este artigo do USENIX Summer 1994, da Sun Microsystems, documenta o alocador que substituiu o sistema buddy do SVr4 no SunOS 5.4. Ele pertence à tradição de kernel iniciada pelo [UNIX](/papers/unix-time-sharing-system), em que o kernel mantém tabelas de registros de tamanho fixo (o i-node é o exemplo clássico). Os limites em muitos núcleos aparecem depois em [escalabilidade do Linux em muitos núcleos](/papers/analysis-of-linux-scalability-to-many-cores), cujas correções incluem listas livres de buffers de pacote por núcleo e caches de vfsmount por núcleo, e um projeto moderno de memória verificado é o [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness).

Vale conhecer antes: o que fazem um construtor e um destrutor, a diferença entre fragmentação interna (desperdício dentro de um buffer) e externa (buffers livres que não podem ser usados), como um cache de hardware de mapeamento direto ou de baixa associatividade mapeia endereços em linhas, e o que é um contador de referências.

## Contribuição

- **Cache de objetos no alocador central.** O estado construído de um objeto (locks embutidos, variáveis de condição, contadores de referências, listas, dados somente leitura) é inicializado uma vez, quando o objeto entra no cache, e preservado entre liberar e realocar. O artigo argumenta que caches privados por subsistema falham porque não enxergam a pressão global de memória, escapam da contabilidade e da depuração e duplicam código.
- **Uma interface dirigida pelo cliente.** Quem descreve os objetos é o cliente, não o alocador: `kmem_cache_create(name, size, align, constructor, destructor)`, `kmem_cache_alloc(cp, flags)` com `KM_SLEEP` ou `KM_NOSLEEP`, `kmem_cache_free(cp, buf)` e `kmem_cache_destroy`. Os usuais `kmem_alloc` e `kmem_free` ficam por cima, com cerca de 30 caches de 8 bytes a 9K em passos de 10 a 20%, e pedidos maiores vão direto ao fornecedor de páginas.
- **Slabs.** Um slab é uma ou mais páginas divididas em pedaços iguais, com um contador de quantos estão alocados. Cada cache tem um front end (`alloc`, `free`) e um back end (`kmem_cache_grow` pega memória do sistema de VM, `kmem_cache_reap` a devolve), e os caches não compartilham estado, então o lock é por cache, não um só sobre o heap inteiro.
- **Estrutura da freelist.** Cada slab tem sua freelist, e o cache mantém uma lista circular duplamente encadeada de slabs, parcialmente ordenada: primeiro os slabs com todos os buffers alocados, depois os parciais, depois os com todos os buffers livres. O ponteiro da freelist do cache aponta para o primeiro slab com buffer livre, e um slab cujo contador chega a zero vai para o fim. Objetos pequenos (menos de 1/8 de página) guardam os dados do slab no fim de um slab de uma página e usam o buffer livre como seu próprio bufctl; objetos grandes têm estruturas de slab e bufctl separadas e uma tabela hash.
- **Coloração.** Cada slab novo começa seus buffers em um deslocamento diferente (a cor) a partir da base alinhada à página, aproveitando a sobra no fim do slab, de modo que os campos quentes não caiam todos nas mesmas linhas de cache.
- **Depuração.** Auditoria em log, padrões de memória liberada (`0xdeadbeef`, `0xbaddcafe`), redzones, desmapeamento síncrono, modo página por buffer e um detector de vazamentos em nível de usuário, ativados sem um kernel especial.

## Metodologia

As medições comparam o novo alocador com outros três portados para a mesma base SunOS 5.4, de modo que só o alocador varia: SunOS 4.1.3 (sequential fit), 4.4BSD (armazenamento segregado em potências de dois) e SVr4 (buddy em potências de dois, usado em todas as versões anteriores do SunOS 5.x). A velocidade é medida em um SPARCstation-2. A utilização usa uma sequência fixa em um SPARCstation-1 de 16MB: boot, um pico que cria 256 processos cada um com um socket, um `find /usr` e o benchmark de timesharing kenbus, lendo a fragmentação a cada passo. Uma semana de uso leve de desktop no SPARCstation-2 de 32MB do autor dá outro ponto, sem controle. Os ganhos no sistema vêm de comparar o SunOS 5.4 com o alocador baseado no SVr4 que ele substituiu.

## Resultados

Todos os números são do artigo, em hardware Sun de 1994.

- **Stream head.** Alocar e liberar um stream head caiu de 33 para 5,7 microssegundos. A tabela do artigo lista 23,6 (construção e destruição), 9,4 (alocação de memória) e 1,9 (outras inicializações) para o alocador antigo, o que soma 34,9 e não 33, e 0,0, 3,8 e 1,9 para o novo. A economia vem sobretudo da parcela de construção.
- **Velocidade pura.** Alocar mais liberar custa 3,8 microssegundos via `kmem_cache_alloc` e 4,7 via `kmem_alloc`, contra 4,1 do 4.4BSD, 9,4 do SVr4 e 25,0 do SunOS 4.1.3. Um par mutex enter e exit custa 1,0, então só o lock impõe um piso de 2,0.
- **Cache de objetos, por tipo de alocação.** Sem versus com cache: `allocb` 8,3 para 6,0 (1,4x), `dupb` 13,4 para 8,7 (1,5x), `shalloc` 29,3 para 5,7 (5,1x), `allocq` 40,0 para 10,9 (3,7x), `anonmap_alloc` 16,3 para 10,1 (1,6x), `makepipe` 126,0 para 98,0 (1,3x).
- **Fragmentação.** A fragmentação total após boot, pico, find e kenbus é 11%, 13%, 14%, 14% no slab, contra 7%, 19%, 19%, 27% no SunOS 4.1.3, 20%, 43%, 43%, 45% no 4.4BSD e 23%, 45%, 45%, 46% no SVr4. Scripts por minuto no kenbus: 233, 210, 205, 199. Após uma semana de desktop, o heap fica em 6,0 MB com 9% no slab, 6,7 MB com 17% no SunOS 4.1.3, 8,5 MB com 35% no SVr4 e 9,0 MB com 38% no 4.4BSD.
- **Cache de hardware.** Em um SPARCcenter 2000 rodando LADDIS, trocar o antigo alocador buddy em potências de dois pelo slab reduziu o desequilíbrio de barramento de 43% para 17% e a taxa de misses do cache primário em 13%.
- **No sistema.** Ganhos sobre o alocador SVr4: DeskBench 12%, kenbus 17%, TPC-B 4%, LADDIS 3%, parallel make 5%, terminal server 5%. O artigo atribui DeskBench e kenbus sobretudo à eficiência de espaço com 16MB, o TPC-B a efeitos de cache (5% menos misses no primário e 2% no secundário) e o terminal server à queda do tempo de kernel de 25% para 20%.
- **Fragmentação por projeto.** Um cache de objetos de 400 bytes em páginas de 4096 cabe 10 buffers com 96 bytes de sobra, 2,4% de fragmentação interna. A fragmentação interna é no máximo 1/n com n buffers por slab, e o SunOS 5.4 a limita a 12,5%.

## Análise crítica

O argumento central é bem sustentado dentro do escopo: as tabelas do stream head e por tipo isolam o efeito do custo de construção, e os outros alocadores rodam no mesmo kernel base. Os limites abaixo são do próprio artigo ou decorrem do texto.

- **O lock para no cache.** O projeto usa um lock por cache, e o artigo põe listas livres por processador como trabalho futuro, citando McKenney e Slingwine.
- **A recuperação tem pouca evidência.** Ela só é disparada por pressão de memória, com um conjunto de trabalho de 15 segundos de slabs recentes. O artigo diz que as medições mostram o desempenho "fairly insensitive" a esse intervalo, mas não mostra os dados.
- **Alguns ganhos vêm juntos.** O resultado de 43% para 17% compara o alocador slab inteiro com um buddy, então a coloração não é medida sozinha. O teste de uma semana no desktop é chamado pelo autor de "obviously non-controlled".
- **O que o artigo não diz.** Não há exemplo de ARP nem de vnode (os exemplos são streams, inode, snode e `foo`), nem caches por CPU, nem comparação com Linux. O ganho do "parallel make" é 5%, sem ser chamado de build de kernel. "Fragmentação externa severa é improvável" é argumentado pelo projeto, não medido separadamente do desperdício total. A tabela de velocidade mede só o alocador.

O trecho a seguir é literatura posterior, não faz parte do artigo de 1994. Bonwick e Adams (USENIX 2001, lido) dizem que o lock global do projeto original não escalava para muitas CPUs e acrescentam uma camada de magazines por CPU e o alocador de recursos vmem, relatando ganhos acima de 50% em LADDIS e SPECweb99, e registram que o alocador slab foi adotado, no todo ou em parte, por Linux, FreeBSD, NetBSD e outros. Um artigo do LWN de abril de 2007 (conhecido só por um resumo obtido por fetch, não lido por inteiro) descreve o SLUB do Linux como abandonando a maioria das filas de objetos por nó e por CPU do SLAB, mantendo slabs ativos por CPU e guardando os metadados do slab em `struct page`.

## Pesquisas futuras

- Cache por processador sobre os slabs: a camada de magazines de 2001 é a continuação, e medir como SLAB e SLUB do Linux diferem do projeto do Solaris em máquinas modernas de muitos núcleos é uma comparação natural.
- Como a coloração de cache se comporta em caches atuais indexados fisicamente e muito associativos, o que o artigo não discute além de dizer que a tendência do hardware era de caches mais simples.
- Se os construtores ajudam quando os objetos são presos a nós NUMA ou precisam ser zerados por segurança.
- Pressão de memória além de um único intervalo de conjunto de trabalho: coordenar a recuperação entre muitos caches e com o page cache.
