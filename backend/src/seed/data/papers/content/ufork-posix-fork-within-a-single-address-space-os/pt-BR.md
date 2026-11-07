---
title: "μFork: suportando o fork do POSIX dentro de um sistema operacional de espaço de endereçamento único"
summary: O μFork permite que um sistema operacional de espaço de endereçamento único execute programas POSIX multiprocesso sem modificação, copiando a memória do pai para outro lugar do mesmo espaço de endereçamento, usando capabilities do CHERI para achar e relocar ponteiros e para isolar as cópias, e um esquema de copy-on-pointer-access para manter o fork barato.
researchArea: Sistemas operacionais
keywords: sistema operacional de espaço de endereçamento único, fork, cheri, copy-on-pointer-access, unikernel, isolamento dentro do espaço de endereçamento, unikraft
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Um sistema operacional de espaço de endereçamento único (SASOS) coloca o kernel e todas as aplicações em um só espaço de endereçamento, como fazem os unikernels. O ganho é a leveza: trocas de contexto e travessias do kernel baratas, IPC rápido e pouca memória. O custo é que o `fork` do POSIX copia um processo para um novo espaço de endereçamento, que um SASOS, por definição, não tem. Programas multiprocesso, por isso, não rodam nesses sistemas. Os autores relatam que 46% dos 50 repositórios C mais populares do GitHub e 50% dos 50 pacotes Debian mais populares (pelo popcon) usam `fork`, para concorrência (Nginx), separação de privilégios (OpenSSH, qmail), snapshots com copy-on-write (Redis), partida rápida (fuzzers, Zygotes de FaaS) e outros fins.

Este artigo do SOSP 2025 (Seul), de John Alistair Kressel e Pierre Olivier, da University of Manchester, e Hugo Lefeuvre, da University of British Columbia, pede um `fork` que seja leve, transparente para as aplicações, isolante entre processos e pelo menos tão rápido quanto o tradicional. Os autores dividem as tentativas anteriores em quatro grupos: endereçamento relativo a segmento nos SASOS dos anos 1990, que as toolchains modernas suportam mal; apenas `vfork` mais `exec` ou `spawn`; tratar o SO inteiro como um processo e fazer o fork dele em um hypervisor ou no host (Nephele, KylinX, Graphene); e reintroduzir múltiplos espaços de endereçamento no SASOS (Iso-UniK). Cada um abre mão de pelo menos um desses objetivos.

Quatro termos merecem atenção. Um μprocess é o processo POSIX emulado que o μFork executa dentro do espaço de endereçamento único. Uma referência absoluta de memória é um ponteiro na memória do filho que, depois da cópia, ainda aponta para a área do pai. Uma capability do CHERI é um ponteiro de 128 bits que carrega limites e permissões, mais uma tag de validade de um bit, oculta, que o hardware zera em qualquer modificação ilegítima. CoPA, copy-on-pointer-access, é a variante de copy-on-write do artigo.

Vale conhecer antes: como funcionam o `fork` do POSIX e o copy-on-write, o que é um unikernel e a ideia de hardware de capabilities. Para contraste, o [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) é outro desenho de library OS que ganha velocidade ao contornar o kernel no caminho de I/O. Esse pareamento é meu, o artigo do μFork não o cita.

## Contribuição

- **Copiar para outro lugar, no mesmo espaço de endereçamento.** As aplicações são compiladas como código independente de posição, então a maioria das referências é relativa à pilha, à base ou ao contador de programa e sobrevive à mudança. Só as referências absolutas precisam ser relocadas. No fork, o kernel reserva uma área contígua para o filho, copia as entradas da tabela de páginas do pai de modo que as páginas físicas comecem compartilhadas, atribui um novo PID guardado onde nenhum μprocess consegue escrever e inicia uma nova thread. A global offset table e as páginas de metadados do alocador são copiadas e corrigidas de imediato.
- **O CHERI resolve os dois problemas difíceis.** As tags identificam as referências absolutas com segurança, inclusive nos registradores, onde um inteiro comum poderia ser confundido com um ponteiro. Os limites restringem cada capability ao seu próprio μprocess, e como os limites só podem diminuir, um μprocess não consegue forjar uma capability mais ampla. Capabilities seladas dão chamadas de sistema sem trap. Como o kernel e os μprocesses compartilham um único nível de privilégio (EL1), um bit de permissão do CHERI impede que o código dos μprocesses execute instruções privilegiadas como MSR e MRS.
- **Copy-on-pointer-access.** O copy-on-write simples falha, porque um filho que só lê uma página poderia carregar um ponteiro desatualizado que aponta para o pai. O copy-on-access copia em qualquer acesso. O CoPA compartilha as páginas somente para leitura e as copia quando qualquer um dos lados escreve, ou quando o filho carrega uma capability da página, usando um bit da tabela de páginas que dispara falha em cargas de capabilities. A cópia redireciona a entrada do filho para uma página livre, copia, depois varre a página em passos de 16 bytes e relocaliza toda referência com tag válida que aponta para fora da área do μprocess ou tem limites que alcançam o lado de fora.
- **Isolamento parametrizado.** Os autores citam três níveis de confiança: processos que desconfiam uns dos outros (qmail), um programa confiável que pode ter bugs (Nginx) e um totalmente confiável (o filho de um snapshot do Redis). A proteção contra ataques de time-of-check-to-time-of-use (TOCTTOU), que consiste em copiar os buffers do usuário para o kernel, pode ser dispensada no segundo, e o isolamento pode ser desligado por completo no terceiro.
- **Protótipo.** O μFork é uma nova biblioteca do Unikraft, portada para o CHERI na placa ARM Morello e executada sob o hypervisor bhyve no CheriBSD, para ter rede VirtIO. Os autores contam 7 KLoC alteradas, 4.230 para o suporte a CHERI e bhyve e 3.000 para o μFork. As aplicações rodam sem port. O Unikraft antes precisou de tabelas de file descriptors, task structs, PIDs e escalonamento por μprocess, e seu suporte a SMP é um big kernel lock. O código é aberto.

## Metodologia

Todos os experimentos rodam em uma placa de desenvolvimento ARM Morello com 4 cores a 2,5 GHz e 16 GB de RAM. A principal base de comparação é o CheriBSD 23.11 rodando nativamente em modo pure-capability com opções de desempenho ligadas, contra o μFork virtualizado no bhyve, o que, segundo os autores, favorece um pouco o CheriBSD. Eles não usam base sem CHERI, porque a pilha do Morello ainda é imatura e acrescenta overheads. O fork de unikernel baseado em VMs Nephele só roda em x86_64, então os autores reproduzem seus microbenchmarks (latência de fork, memória) no μFork e comparam com números tirados do artigo dele. Os gráficos mostram médias de 10 execuções com desvio padrão.

Três aplicações cobrem usos diferentes do `fork`. O Redis povoa um banco com entradas de 100 KB (tamanhos totais de 100 KB a 100 MB), dispara um save em segundo plano para um RAM disk e mede o tempo de save, a latência de fork e a memória. O Nginx é carregado com o wrk, com 1 a 3 workers. Um Zygote de FaaS (MicroPython, a função float_operation do FunctionBench) faz uma thread dar fork o mais rápido possível por 10 segundos em 1 a 3 cores, com um quarto core para o coordenador. Os microbenchmarks acrescentam um fork de hello-world, o Unixbench Spawn (1.000 forks) e o Context1 (um pipe entre dois processos, até 100.000). Uma ablação compara CoPA, CoA e uma cópia síncrona completa no Redis.

## Resultados

Estes são os resultados relatados pelos autores.

- **Latência de fork e memória.** Dar fork em um processo hello-world leva 54 μs no μFork, 197 μs no CheriBSD (3,7×) e 10,7 ms no Nephele (198×), que precisa criar um domínio Xen. A memória por processo é de 0,13 MB, contra 0,29 MB e 1,6 MB, ou seja, 2,2× e 12,3× menos.
- **Unixbench.** 1.000 forks e saídas levam 56 ms no μFork e 198 ms no CheriBSD. O Context1 leva 245 ms contra 419 ms, o que os autores atribuem a chamadas de sistema sem exceção em um único nível de privilégio.
- **Redis.** O tempo de save é de 1,8 ms contra 3,4 ms com 100 KB (1,9×) e de 109 ms contra 158 ms com 100 MB (1,4×). A latência de fork é de 5× a 10× menor. Com 100 MB, um processo filho usa 6 MB no μFork e 56 MB no CheriBSD, e os autores acrescentam que 7 MB é o que o Linux usa na mesma placa. A proteção contra TOCTTOU custa 2,6% com 100 MB.
- **Ablação do CoPA, banco de 100 MB.** Uma cópia completa move 144 MB (136,7 MB são o heap estático) e faz o fork em 23,2 ms. O CoA usa 101 MB e 283 μs. O CoPA usa 6 MB e 260 μs. Os autores relatam latência de fork até 89× menor que a de uma cópia completa e até 1,18× menor que a do CoA.
- **FaaS.** O μFork executa 24% mais funções por segundo que o CheriBSD, e a proteção contra TOCTTOU custa quase nada, já que a função não faz chamadas de sistema.
- **Nginx.** Por causa dos limites de SMP do Unikraft, o μFork rodou em um core só. Ainda assim, ir de 1 para 3 workers rende 15,6%, e contra o CheriBSD restrito a um core ele atende 9% mais requisições. O CheriBSD com vários cores é mais rápido. A proteção contra TOCTTOU custa 6,5% em média.

## Análise crítica

O artigo é aberto sobre vários limites. Ele admite o seguinte.

- **Fragmentação.** Cada μprocess precisa de uma área contígua grande. Os autores esperam que um espaço de 64 bits baste para a maioria dos programas multiprocesso e deixam a compactação e as classes de tamanho para os casos de longa duração ou de muitos forks.
- **Nenhum resultado multicore para o Nginx.** O big kernel lock impediu os autores de obter números multicore estáveis, o que eles chamam de problema do Unikraft e não do μFork. A concorrência é mostrada só em até três cores.
- **Ressalvas da plataforma.** O Morello é um protótipo com overheads conhecidos, que os autores esperam ver cair para 1,8% a 3% em hardware futuro. O CoPA precisa da falha em carga de capability do CHERI, e os autores não conhecem outro mecanismo que a ofereça, embora o CoA funcione sem ela. Canais laterais de execução transitória estão fora do escopo.
- **Engenharia fora da ideia central.** Acrescentar estado de kernel por processo a um SASOS de processo único pode dar um trabalho nada desprezível, e cada μprocess tem um heap estático cujo tamanho é fixado na compilação.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **"Uma ordem de grandeza" é seletivo.** Vale contra o Nephele (198× e 12,3×) e para a latência de fork do Redis, mas contra o CheriBSD o fork de hello-world é 3,7×, o Spawn cerca de 3,5× e o Context1 cerca de 1,7× (razões calculadas a partir dos tempos relatados). De ponta a ponta, os ganhos são 1,4× no Redis com 100 MB e 24% no FaaS.
- **As razões contra o Nephele cruzam plataformas.** Elas comparam números do Morello com valores do artigo x86_64 do Nephele, então mostram a escala mais do que um fator controlado. Os autores explicam a diferença de 6 MB contra 56 MB no Redis pelo consumo de memória do alocador do CheriBSD, e contra o único número do Linux (7 MB) o resultado é um empate.
- **A base de cópia completa é moldada pelo próprio desenho.** Dos 144 MB, 136,7 MB são o heap estático, então os 89× medem em parte essa escolha. A diferença entre CoA e CoPA é o resultado mais limpo: 283 contra 260 μs com 100 MB dá cerca de 1,1×, e o texto não diz onde ocorre o 1,18×.
- **O isolamento é argumentado, não atacado.** A segurança se apoia na monotonicidade do CHERI e em o CoPA nunca vazar capabilities do pai. O artigo relata apenas o custo das verificações, sem teste adversarial nem verificação formal, e o uso de separação de privilégios (OpenSSH, qmail) não é executado. O [Spectre](/papers/spectre-attacks-exploiting-speculative-execution) é o exemplo clássico de execução transitória minando um isolamento construído sobre verificações de limites, e o artigo não o cita.
- **A transparência é mostrada em três programas.** Não há uma rodada ampla de compatibilidade. Depois da relocação, os ponteiros do filho diferem numericamente dos do pai, e o artigo não discute programas em que um endereço é observável, como tabelas hash indexadas por ponteiro ou endereços escritos em um pipe.
- **Algumas funcionalidades são descritas, não construídas.** ASLR por deslocamento-base aleatório, memória compartilhada e bibliotecas compartilhadas são chamadas de diretas, e o artigo não relata implementação nem medição para elas.

## Pesquisas futuras

- Escalar o μFork em vários cores quando o big kernel lock do Unikraft for substituído, o que os autores dizem que a comunidade está fazendo, para testar a afirmação de concorrência no Nginx.
- Heaps dinâmicos no lugar do heap estático por μprocess, mais compactação do espaço de endereçamento ou classes de tamanho contra a fragmentação, ambos citados pelos autores.
- Outros hardwares: isolamento por tags ou no estilo MPK com instrumentação do compilador ou shadow memory, e chips RISC-V com CHERI, para ver quanto do CoPA sobrevive sem uma falha em carga de ponteiro.
- Avaliação adversarial do isolamento dos μprocesses, uma suíte de compatibilidade mais ampla, e um estudo de programas que observam ponteiros e de bases sem CHERI.
