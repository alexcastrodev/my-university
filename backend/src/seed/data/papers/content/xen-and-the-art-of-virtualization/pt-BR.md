---
title: "Xen e a arte da virtualização"
summary: O grupo de Cambridge apresenta o Xen, um hipervisor para x86 que roda vários sistemas operacionais comuns lado a lado por meio de paravirtualização (kernel convidado modificado, interface de aplicações intacta), e relata sobrecustos de no máximo alguns por cento contra o Linux nativo nos benchmarks medidos.
researchArea: Sistemas operacionais
keywords: xen, virtualização, hipervisor, paravirtualização, monitor de máquinas virtuais, anéis de e/s, isolamento de desempenho
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Muitos sistemas foram projetados para usar virtualização e subdividir os recursos abundantes de um computador moderno. Alguns exigem hardware especializado ou não suportam sistemas operacionais comuns. Alguns visam 100% de compatibilidade binária à custa de desempenho. Outros sacrificam segurança ou funcionalidade por velocidade. Poucos oferecem isolamento de recursos ou garantias de desempenho; a maioria dá apenas provisionamento de melhor esforço, com risco de negação de serviço.

Este artigo apresenta o Xen, um monitor de máquinas virtuais para x86 que permite a vários sistemas operacionais comuns compartilhar hardware convencional de forma segura e com gerenciamento de recursos, sem sacrificar desempenho nem funcionalidade. Isso é obtido oferecendo uma abstração idealizada de máquina virtual para a qual sistemas como Linux, BSD e Windows XP podem ser portados com esforço mínimo.

O projeto mira hospedar até 100 instâncias de máquinas virtuais ao mesmo tempo em um servidor moderno. A virtualização do Xen é extremamente eficiente: permite hospedar simultaneamente sistemas como Linux e Windows XP com sobrecusto de desempenho desprezível, no máximo alguns por cento em relação ao caso sem virtualização. O sistema supera de forma considerável soluções comerciais e gratuitas concorrentes em vários microbenchmarks e testes do sistema inteiro.

## Visão geral

O artigo saiu no SOSP 2003 (Bolton Landing, Nova York), do Laboratório de Computação da Universidade de Cambridge. Ele está no renascimento dos monitores de máquinas virtuais do início dos anos 2000, quando a meta era rodar muitas instâncias de sistemas operacionais que não confiam umas nas outras em um servidor x86 barato, para hospedagem e consolidação de servidores. O alvo dos autores era o projeto XenoServer, uma plataforma de escala de Internet em que o usuário paga pelos recursos da máquina virtual que inicia.

O problema é que o x86 não foi desenhado para virtualização clássica. Algumas instruções privilegiadas falham em silêncio em vez de gerar uma interrupção, e a tabela de páginas percorrida pelo hardware é difícil de virtualizar. O artigo descreve o ESX Server da VMware como resolvendo isso reescrevendo dinamicamente o código do kernel convidado e mantendo tabelas de páginas sombra. O Xen segue o outro caminho, chamado no artigo de paravirtualização: apresenta uma máquina virtual parecida, mas não idêntica, ao hardware, de modo que o kernel convidado é portado e as aplicações não.

Termos principais: o hipervisor é o próprio Xen, um domínio é uma máquina virtual em execução e o Domain0 é o primeiro domínio, que hospeda o software de gerenciamento. Vale conhecer antes: anéis de proteção, tabelas de páginas em hardware e o TLB, e o custo de uma chamada de sistema e de uma falta de página. As ligações abaixo são minhas, o artigo de 2003 não poderia citá-las. [Um monitor de firmware virtual](/papers/virtual-firmware-monitor-design-and-implementation) aplica a receita oposta (interceptar e emular um convidado sem modificação) ao firmware de RISC-V. [A proteção da informação em sistemas computacionais](/papers/protection-of-information-in-computer-systems) é o vocabulário mais antigo para a pergunta de quem pode tocar em quê. O próprio artigo se apoia no Exokernel e no Nemesis para a ideia de multiplexar em nível baixo, e se contrapõe ao Denali.

## Contribuição

- **Paravirtualização como escolha de projeto.** Quatro princípios: binários de aplicação sem modificação são essenciais, sistemas completos com várias aplicações devem ser suportados, a paravirtualização é necessária para desempenho e isolamento no x86, e esconder totalmente a virtualização do convidado arrisca correção e desempenho.
- **Uma interface x86 virtual (Tabela 1).** O convidado roda no anel 1 sob o Xen no anel 0, registra seus tratadores de exceção e um tratador rápido opcional de chamadas de sistema, e enxerga tempo real e virtual.
- **Memória sem tabelas sombra.** As tabelas de páginas do convidado são registradas diretamente na MMU, mapeadas como somente leitura, e as atualizações passam por hypercalls que o Xen valida. Cada quadro tem um tipo (diretório de páginas, tabela de páginas, tabela de descritores ou gravável) e uma contagem de referências. O Xen ocupa 64MB no topo de cada espaço de endereçamento para evitar esvaziar o TLB ao entrar.
- **Hypercalls e eventos.** Chamadas síncronas vão do domínio ao Xen, e notificações assíncronas voltam como eventos em uma máscara de bits por domínio.
- **Anéis de E/S assíncronos.** Anéis de descritores em memória compartilhada, com buffers fora do anel, ponteiros de requisição e resposta, sem exigência de ordem.
- **Separação entre controle e gerenciamento.** O Domain0 cria domínios, configura as interfaces de rede e os dispositivos de bloco virtuais e guarda a política, enquanto o hipervisor mantém só mecanismos.
- **Um balloon driver no XenoLinux**, atribuído ao artigo do VMware ESX Server, que ajusta a memória de um domínio pelo próprio alocador de páginas do convidado.

## Metodologia

O sistema é um hipervisor mais o XenoLinux, um port do Linux 2.4.21. Os ports de Windows XP e NetBSD estavam em andamento e não são avaliados. A Seção 4 compara Linux nativo, XenoLinux, VMware Workstation 3.2 e User-mode Linux (variante skas3) em um Dell 2650 com dois Xeon de 2,4GHz, 2GB de RAM, placa gigabit e um disco SCSI. O hyperthreading ficou desligado, os convidados usaram uma CPU e os resultados são medianas de sete execuções (nove nos testes de rede).

As cargas são SPEC INT2000, compilação do kernel Linux, PostgreSQL 7.1.3 sob o OSDB (recuperação de informação e OLTP), dbench, SPEC WEB99 com Apache, 37 microbenchmarks do lmbench, ttcp em Ethernet gigabit e depois execuções com vários domínios: até 16 instâncias de SPEC WEB99, até 8 de OSDB, uma mistura com dois domínios hostis e até 128 domínios rodando SPEC CINT2000. O VMware ESX Server foi medido, mas, como diz o artigo, a licença proíbe publicar os números.

## Resultados

Todos os números abaixo são do artigo, de uma única máquina, Linux 2.4 e os benchmarks acima.

- **Benchmarks de um só sistema (Figura 3), Linux nativo contra XenoLinux.** SPEC INT2000 567 e 567; compilação do Linux 263 s e 271 s; OSDB-IR 172 e 158 tup/s; OSDB-OLTP 1714 e 1633 tup/s; dbench 418 e 400; SPEC WEB99 518 e 514. O texto diz que o XenoLinux fica a 1% no SPEC WEB99, enquanto VMware e UML sustentam menos de um terço dos clientes (150 e 172 na figura). Na compilação, o sobrecusto de tempo de sistema do Xen é de 3%. O VMware Workstation marca 334 s na compilação, 80 no OSDB-IR, 199 no OSDB-OLTP e 310 no dbench; o UML marca 535 s, 65, 306 e 111.
- **Microbenchmarks.** Em 24 dos 37 testes do lmbench o XenoLinux é parecido com o nativo. Fork, exec e sh são mais lentos (fork 198 µs contra 110 µs do Linux uniprocessador), o que o artigo atribui às atualizações de tabela de páginas que o Xen precisa validar. O agrupamento permite que uma hypercall leve até 2048 atualizações, que montam 8MB de espaço de endereçamento.
- **Rede.** Com MTU de 1500, o ttcp dá 897 Mb/s para Linux e para Xen nos dois sentidos, contra 291 enviados e 615 recebidos no VMware e 165 e 203 no UML. Com MTU de 500, o Xen perde 14%.
- **Domínios concorrentes.** Em duas CPUs o Linux nativo chega a 662 clientes conformes no SPEC WEB99 com um Apache; um único domínio Xen melhora em 9% o próprio resultado de uma CPU, e com mais domínios o Xen chega a poucos por cento do nativo. Várias instâncias de PostgreSQL em um só Linux marcam de 25 a 35% menos que as mesmas instâncias em domínios separados, e o artigo diz que a causa não é totalmente entendida.
- **Isolamento.** Com dois domínios hostis rodando um consumidor de disco, uma fork bomb e um consumidor de memória, OSDB-IR e SPEC WEB99 caem 4% e 2%. No Linux nativo a máquina ficou inutilizável para os dois benchmarks.
- **Escalabilidade.** Um domínio encolhe para 6,2MB de memória (4,2MB com swap), e o Xen guarda 20kB de estado por domínio. Com 128 domínios limitados por CPU, a vazão cai 7,5%; com fatia de 50 ms em vez de 5 ms a diferença quase some, ao custo da interatividade. A latência UDP até um domínio ocupado foi em média de 147 ms (desvio padrão 97), contra 5,4 ms para um 129º domínio ocioso.
- **Custo do port (Tabela 2).** 2995 linhas modificadas ou acrescentadas no Linux (1,36% do código x86) e 4620 no Windows XP (0,04%), este sem drivers de dispositivo virtuais.

## Análise crítica

A tese central, de que a paravirtualização evita o custo de imitar o hardware, é sustentada por uma avaliação cuidadosa e com vários benchmarks. Limites que o próprio artigo declara ou deixa em aberto:

- **Sem números do concorrente comercial mais forte.** O ESX Server só é descrito, não medido em publicação, então "supera de forma perceptível o ESX Server" não pode ser conferido pelo artigo.
- **Os convidados precisam de kernel modificado.** O artigo chama o port do Windows XP de incompleto, ainda sem drivers de E/S virtuais, e a generalidade para sistemas de código fechado se apoia em trabalho parcial.
- **Os convidados são de uma CPU, e o artigo admite.** Ele aponta a falta de suporte a convidados SMP como um empecilho em um resultado e usa configurações de uma CPU na maior parte.
- **O isolamento é mostrado por um experimento,** com dois domínios hostis, e o escalonador de disco é descrito como simples. Não há análise de segurança nem estudo de ataques, e o Domain0 é confiável.
- **Migração não faz parte deste artigo.** Ele cita trabalhos de suspensão e migração só como motivação para mobilidade de aplicações e não descreve migração ao vivo.
- **Tudo é de 2003:** Linux 2.4, um servidor Xeon, RedHat 7.2.

Literatura posterior (não faz parte deste artigo). Adams e Agesen (ASPLOS 2006, VMware, conferido em cópia hospedada por um curso) relatam que, depois que Intel e AMD acrescentaram suporte em hardware à virtualização clássica, um VMM assistido por hardware muitas vezes teve desempenho pior que o VMM de software da VMware, porque o hardware não oferecia virtualização da MMU; eles também observam que a paravirtualização ganha desempenho, mas abre mão de sistemas operacionais legados e proprietários. O Firecracker (NSDI 2020, AWS, conferido no PDF da USENIX) mantém o KVM e troca o QEMU, e menciona que alguns projetos anteriores de VMs leves enxugaram o Xen; um de seus autores, Rolf Neugebauer, também é autor deste artigo.

## Pesquisas futuras

- Virtualização assistida por hardware e suporte de MMU: quando ela supera a paravirtualização e quando uma interface paravirtual de dispositivos ainda compensa.
- Isolamento de desempenho mais forte, inclusive no escalonamento de disco e de rede, que os autores citam como trabalho futuro.
- As extensões planejadas no artigo: cache de blocos compartilhado, dispositivos de bloco virtuais com cópia na escrita, um last-chance page cache e contabilização para o XenoServers.
- Bases confiáveis menores que um Domain0 completo, e VMMs mínimos para cargas curtas e de alta densidade, como no Firecracker.
- Reproduzir a comparação em hardware e kernels modernos.
