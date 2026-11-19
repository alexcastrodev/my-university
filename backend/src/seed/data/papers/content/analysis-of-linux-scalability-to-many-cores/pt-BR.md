---
title: "Uma análise da escalabilidade do Linux em muitos núcleos"
summary: Boyd-Wickizer e colegas rodam sete aplicações que exigem muito do kernel no Linux 2.6.35-rc5 com 48 núcleos, encontram os gargalos do kernel um a um e os removem com 16 mudanças locais (3002 linhas alteradas, mais o novo contador esparso), concluindo que ainda não há razão de escalabilidade para abandonar os projetos tradicionais de kernel.
researchArea: Sistemas operacionais
keywords: escalabilidade do Linux, multicore, MOSBENCH, contadores esparsos, contenção de locks, estruturas de dados por núcleo, falso compartilhamento, cache de dentry, 48 núcleos
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo analisa a escalabilidade de sete aplicações de sistema (Exim, memcached, Apache, PostgreSQL, gmake, Psearchy e MapReduce) rodando no Linux em um computador de 48 núcleos. Com exceção do gmake, todas as aplicações disparam gargalos de escalabilidade dentro de um kernel Linux recente. Usando técnicas de programação paralela majoritariamente padrão (o artigo introduz uma técnica nova, os contadores esparsos, ou sloppy counters), esses gargalos podem ser removidos do kernel ou evitados com pequenas mudanças nas aplicações. Modificar o kernel exigiu, no total, 3002 linhas de código alteradas. Uma conclusão especulativa desta análise é que ainda não há razão de escalabilidade para abandonar as organizações tradicionais de sistema operacional.

## Visão geral

Por volta de 2010, muitos pesquisadores defendiam que kernels feitos para poucos núcleos deixariam de escalar conforme os chips ganhassem mais, e propunham projetos novos: Barrelfish, Corey e fos. Este artigo do OSDI 2010, do MIT CSAIL, faz a pergunta direta: até onde um Linux comum chega? É um estudo de medição e correção, não um sistema operacional novo. Os autores modificam o kernel (e às vezes a aplicação) até que cada carga escale ou até que o limite restante seja atribuído a outra coisa.

O cenário é o projeto monolítico de memória compartilhada que o [UNIX](/papers/unix-time-sharing-system) popularizou, em contraste com a linha de sistemas operacionais de biblioteca do [exokernel](/papers/exokernel-os-architecture-application-level-resource-management), que divide um autor (Kaashoek) com este artigo. O lado de gerência de memória é revisitado pelo [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness), que reutiliza dois destes benchmarks. A contagem de referências, alvo dos contadores esparsos, é o tema do estudo de bugs em [Refcounting bugs no Linux](/papers/refcounting-bugs-in-all-modern-linux-kernels).

Vale conhecer antes: a Lei de Amdahl (uma pequena parte serial limita o ganho), a coerência de cache (escrever numa linha que outro núcleo tem exige uma ida e volta de invalidação) e o falso compartilhamento (duas variáveis sem relação na mesma linha de cache).

## Contribuição

- **16 melhorias de escalabilidade no kernel.** Elas formam o kernel modificado PK, a partir do Linux 2.6.35-rc5. A Figura 1 do artigo as lista; as correções acrescentam 2617 linhas e removem 385.
- **Contadores esparsos (sloppy counters).** Um contador lógico vira um contador central compartilhado mais contagens por núcleo de referências sobressalentes. O núcleo usa uma referência local sobressalente quando tem uma e só toca o contador central caso contrário. Os usos existentes do contador não precisam mudar, o que combina com o Linux, onde só alguns usos de um contador são gargalos. Os autores apontam dois custos: o espaço cresce com o número de núcleos, e reconciliar os contadores é caro, então servem para objetos raramente liberados.
- **MOSBENCH.** As sete aplicações são liberadas publicamente como suíte de benchmarks de escalabilidade de sistemas operacionais.
- **As correções no kernel.** Filas de backlog do accept por núcleo para sockets de escuta; contadores esparsos para dentry, vfsmount, dst entry e contagem de memória de protocolo; protocolo sem lock, com contador de geração, para comparar dentries; listas de arquivos abertos por núcleo, caches de vfsmount por núcleo e listas livres de buffers de pacote por núcleo; separar campos mais lidos que escritos em linhas de cache próprias; alocação de buffers de DMA no nó local; evitar os locks das listas de inode e de dcache e o mutex por inode no `lseek`; locks mais finos para super-páginas; e instruções que não passam pelo cache para zerar super-páginas.
- **Um argumento** de que nenhuma razão imediata de escalabilidade justifica abandonar os projetos tradicionais de kernel.

## Metodologia

A máquina é uma Tyan Thunder S4985 com oito chips AMD Opteron 8431 de 6 núcleos a 2,4 GHz (48 núcleos, 8 GB de DRAM por chip) e uma placa Intel 82599 de 10 Gbit (IXGBE), com máquinas clientes num switch. As aplicações que modificam arquivos rodam em tmpfs para evitar esperas de disco, o que, segundo os autores, aumenta a pressão sobre o kernel em relação a uma implantação real e torna os resultados absolutos pouco representativos. Nas execuções com menos núcleos os demais são desativados, e cada execução é repetida 3 vezes, mantendo o melhor throughput. As cargas são propositalmente pesadas no kernel: Exim (69% do tempo de um núcleo no kernel), memcached (80%), Apache (60%), PostgreSQL (1,5% com um núcleo, 82% com 48 numa execução só de leitura), gmake, Psearchy (pedsort) e Metis. O ciclo é iterativo: medir, localizar o gargalo, corrigir o kernel ou a aplicação e repetir, porque cada correção expõe a próxima. Os resultados são plotados como throughput por núcleo, em que uma linha horizontal é escalabilidade perfeita.

## Resultados

Os números abaixo são os do próprio artigo.

- **Por aplicação.** O gmake roda 35 vezes mais rápido com 48 núcleos do que com um, nos dois kernels, limitado por etapas seriais e processos atrasados. O Exim no Linux original tem o throughput por núcleo despencando para perto de zero por causa do spin lock da tabela de vfsmount, e o PK escala bem melhor. O memcached ganha cerca de 30% com a alocação de pacotes no socket local e 30% com 48 núcleos ao remover uma única linha de cache com falso compartilhamento em `net_device`.
- **PostgreSQL.** Duas causas: o próprio gerenciador de locks (16 mutexes globais, elevados a 1024 com caminho sem lock quando não há contenção) e o `lseek` do kernel, cujo mutex de inode sofria starvation sob contenção e levou o tempo de sistema de 1,7 para 322 microssegundos por consulta entre 32 e 48 núcleos. O PK remove o mutex.
- **Psearchy e Metis.** O pedsort com threads gastou 41 s de tempo de sistema com 48 núcleos contra 2,3 s com um, porque um mutex por processo serializa `mmap` e `munmap`. Cerca de 10 linhas mudaram para usar processos. O Metis melhorou com super-páginas de 2 MB e locks de super-página mais finos.
- **O que ainda limita (Figura 12).** Todos os limites restantes são externos ao kernel: diretórios de spool do Exim (aplicação), filas de transmissão e de recepção da placa de rede no memcached e no Apache (hardware), um spin lock no PostgreSQL (aplicação), etapas seriais do gmake, capacidade de cache no pedsort e vazão de DRAM no Metis (50,0 de 51,5 Gbyte/s). O FIFO de recepção da placa do Apache transborda mesmo com os clientes enviando só 2 Gbit/s e 2,8 milhões de pacotes/s.
- **Conclusão.** A maioria dos gargalos do kernel cedeu a mudanças modestas e localizadas, e os autores concluem que o projeto do Linux é compatível com a escalabilidade do MOSBENCH até 48 núcleos.

## Análise crítica

O artigo declara seus próprios limites: a conclusão é "especulativa", o I/O de disco é removido, algumas cargas são sintéticas, e mais núcleos ou outras aplicações vão expor novos gargalos (a criação de threads e processos é citada como candidata provável). Ele não afirma que o Linux escala para qualquer carga, que as mudanças foram incorporadas ao kernel oficial, nem que um projeto novo não poderia ir melhor em desempenho absoluto.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A afirmação vale para estas sete aplicações.** "Mudanças modestas bastam" é mostrado por uma amostra de cargas escolhidas em parte por exigirem muito do kernel, e as mudanças nas aplicações também pesam (memcached em uma instância por núcleo, diretórios de spool do Exim, processos no pedsort, gerenciador de locks do PostgreSQL).
- **Dois limites são atribuídos ao hardware por inferência.** Os limites da placa de rede no memcached e no Apache se apoiam em contadores da placa e num microbenchmark, não numa execução com outra placa.
- **Esforço conta como evidência.** 3002 linhas alteradas é pouco, mas isso mede o quanto as correções foram locais, não o quanto são fáceis de manter entre versões do kernel.

Literatura posterior, que não faz parte deste artigo: a [Scalable Commutativity Rule](https://doi.org/10.1145/3068914) dos próprios autores (Clements, Kaashoek, Kohler, Morris, Zeldovich, CACM 2017) formaliza uma abordagem de software escalável guiada pela interface, relacionada à especulação do artigo sobre a API de chamadas de sistema, e ["Scalable address spaces using RCU balanced trees"](https://doi.org/10.1145/2150976.2150998), de Clements, Kaashoek e Zeldovich (ASPLOS 2012), trata a escalabilidade de espaços de endereçamento com árvores balanceadas e RCU. O CortenMM, acima, é um redesenho recente de memória virtual avaliado contra o Linux com 384 núcleos.

## Pesquisas futuras

- Quais das 16 correções foram generalizadas ou substituídas em versões posteriores do Linux, e com quantos núcleos surgem os próximos gargalos?
- O custo de criação de threads e processos entre núcleos, que o artigo espera que cresça.
- Se a premissa de memória compartilhada com cache coerente sobrevive a hardware sem coerência rápida, ponto levantado pelo artigo.
- Aplicar ao Linux as técnicas de pesquisa em multicore que o artigo lista (faixas de endereços, núcleos dedicados, troca de mensagens sobre memória compartilhada).
