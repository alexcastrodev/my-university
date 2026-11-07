---
title: "Projeto e implementação de um monitor de firmware virtual"
summary: O Miralis executa firmware de fornecedor sem modificações em modo usuário no RISC-V, interceptando e emulando suas instruções privilegiadas, de modo que um monitor de segurança não precisa mais confiar nesse firmware, e partes centrais do emulador são verificadas automaticamente contra o modelo oficial da ISA.
researchArea: Sistemas operacionais
keywords: monitor de firmware virtual, risc-v, ambientes de execução confiáveis, trap and emulate, isolamento de firmware, métodos formais leves
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Ambientes de execução confiáveis (TEEs), como enclaves e VMs confidenciais, dependem de um monitor de segurança que protege as aplicações de um kernel ou hypervisor não confiável. No RISC-V esse monitor costuma rodar em machine mode (M-mode), o nível de privilégio mais alto da CPU de aplicação, ao lado do firmware do fornecedor, que pode ter dezenas ou centenas de milhares de linhas de código e muitas vezes é um binário fechado. A imagem inteira do firmware fica, portanto, dentro da base de computação confiável (TCB) do monitor. A Arm separa os dois com modos extras, como o TrustZone, mas o firmware continua mais privilegiado que o monitor.

Este artigo do SOSP 2025 (Seul), da EPFL e da ETH Zurich, com Cornell e Jane Street na lista de autores, pergunta se o princípio do menor privilégio pode ser aplicado ao próprio firmware. A resposta é uma nova classe de software de sistema, o monitor de firmware virtual (VFM), e sua primeira implementação, o Miralis.

Termos principais: vM-mode é o M-mode virtual em que o firmware roda, fisicamente em modo usuário. Trap and emulate é a técnica clássica de virtualização que o Miralis aplica a ele. Fast path offloading é um subsistema opcional que trata dentro do Miralis os pedidos mais frequentes ao firmware. PMP (physical memory protection) é o mecanismo do RISC-V para proteção de memória sem MMU, e SBI é a interface padrão entre o SO e o software de M-mode.

Vale conhecer antes: os níveis de privilégio do RISC-V (M, S e U), a condição de Popek e Goldberg de que toda instrução sensível deve ser privilegiada, e o que um monitor de segurança faz em um TEE. O artigo cita o [Spectre](/papers/spectre-attacks-exploiting-speculative-execution) apenas para deixar os ataques de execução transiente fora do seu modelo de ameaça.

## Contribuição

- **Virtualização de firmware.** Os autores afirmam que o M-mode do RISC-V é virtualizável no sentido clássico, enquanto o EL3 da Arm não é, com base em uma revisão manual. O exemplo deles é a instrução `cpsid`, que depende do nível de privilégio mas, em modo usuário, não faz nada em vez de gerar um trap. O SO do host roda nativamente, então um VFM não acrescenta custo durante a execução do SO, apenas quando o SO entra no firmware.
- **Virtualização de CPU e memória no Miralis.** O Miralis é escrito em Rust e mantém uma cópia sombra dos CSRs. Ele emula 12 instruções privilegiadas e 84 CSRs. A cada trap ele emula, injeta interrupções virtuais que estejam pendentes e habilitadas ao mesmo tempo, e faz um world switch quando necessário. Os registradores PMP são multiplexados: o Miralis mantém as próprias entradas com prioridade mais alta, dá ao firmware entradas PMP virtuais e usa três entradas extras para imitar o acesso do M-mode, o modo de endereçamento Top of Range e o bit `mstatus.MPRV`.
- **Dispositivos, DMA e fast path.** Nas plataformas estudadas, só o controlador de interrupções CLINT precisa de emulação. Como o suporte a IOPMP é raro, o Miralis bloqueia o acesso do firmware às regiões MMIO de dispositivos com DMA. Em um boot de Linux em uma placa, os autores observam que cinco causas explicam 99,98% dos traps para o firmware: leitura do registrador de tempo, configuração do timer, loads e stores desalinhados, IPIs e remote fences. Eles as implementam no Miralis, cada uma em 10 a 100 linhas, já que são especificadas pelo padrão aberto do RISC-V.
- **Módulos de política.** Uma política de isolamento é uma struct Rust com sete hooks opcionais, mais entradas PMP que têm prioridade sobre as do firmware. Existem três políticas. O sandbox de firmware nega ao firmware a memória do SO, o espaço PCIe e a maioria dos dispositivos MMIO, e salva e restaura registradores, com uma lista de permissões de SBI gerada a partir da especificação. A política Keystone é uma reescrita em Rust do monitor de enclaves Keystone. A política ACE porta o monitor de VMs confidenciais ACE, co-localizado com o Miralis.
- **Verificação leve.** A especificação do VFM é expressa como função do modelo oficial Sail do RISC-V, por meio de dois critérios. A emulação fiel diz que instruções privilegiadas interceptadas produzem o mesmo estado de uma máquina de referência. A execução fiel diz que o hardware do host é configurado para que o código não privilegiado se comporte como nessa máquina. Os autores traduzem o Sail para Rust (um backend de 2K linhas em OCaml, escrito por eles) e verificam o Miralis com o model checker Kani.

## Metodologia

O Miralis foi portado para o VisionFive 2 da StarFive (cores U74 em ordem, 4 cores a 1,5 GHz, 4 GB, Linux 5.15) e para o HiFive Premier P550 da SiFive (cores fora de ordem com a extensão H, 4 cores a 1,8 GHz, 16 GB, Linux 6.6). Ele é inserido entre os dois estágios do firmware de M-mode de cada fornecedor. Salvo indicação em contrário, a política de sandbox fica ligada, os resultados são médias de 5 execuções, e um cliente remoto com 8 cores a 3,5 GHz gera a carga dos testes de rede. A configuração "Miralis no-offload" desliga o fast path.

A avaliação responde a quatro perguntas: dá para virtualizar firmware de fornecedor sem modificações, um VFM deixa o SO mais lento, o fast path é necessário nas CPUs atuais, e dá para construir políticas para enclaves e VMs confidenciais. Firmware testado: os segundos estágios dos fornecedores, baseados em OpenSBI (31,8k e 24,7k linhas), o RustSBI, o Zephyr, e a imagem fechada de 164 kB de uma terceira placa, a Star64. Medições: o custo de uma instrução emulada (`csrw mscratch, x0`) e de um world switch com firmware e kernel mínimos, 100 mil leituras de tempo e IPIs em loop, CoreMark-Pro, IOzone com O_DIRECT, Memtier contra o Memcached com 32 conexões, tempo de boot, Redis e Memcached sob o workload A do YCSB, MySQL sob Sysbench OLTP com 128 clientes, e a compilação do Redis com o GCC. O Keystone é verificado com o RV8, e o ACE com uma VM Linux confidencial no QEMU.

## Resultados

Estes são os resultados reportados pelos autores.

- **Firmware sem modificações roda.** Os dois firmwares de fornecedor dão boot no Linux sob o Miralis sem diferença visível além de logs extras, o RustSBI e o Zephyr passam em seus conjuntos de testes virtualizados, e o binário da Star64 rodou sem o código-fonte. No P550, o Miralis permite escritas em quatro CSRs não padronizados que controlam especulação e relatório de erros.
- **Custo das operações.** Uma instrução emulada custa 483 ciclos no VisionFive 2 e 271 no P550, e um world switch de ida e volta custa 2704 e 4098 ciclos. Um trap vindo do SO exige cerca de 10 emulações, o que dá aproximadamente 7.000 ciclos ou 5 µs. Com o fast path, uma leitura de tempo leva 208 ns contra 288 ns do OpenSBI nativo, e um IPI leva 3,65 µs contra 3,96 µs. Sem ele, levam 7,26 µs e 39,8 µs.
- **Sem overhead com o fast path.** Nos microbenchmarks há em média 0,479 world switches por segundo, e 0,486 por segundo nos benchmarks de aplicação no VisionFive 2 (nenhum no P550). Nas aplicações com muito tráfego de rede, o Miralis é até 7,6% e 1,2% mais rápido nas duas placas, o que os autores atribuem a um fast path ligeiramente mais eficiente. O boot leva 48,0 s contra 47,5 s.
- **Sem o fast path.** O overhead acompanha a taxa de traps: 1,9% no CoreMark-Pro (11 mil traps por segundo), 10,6% no IOzone, 2× a latência do Memcached (388 mil traps por segundo), 61,3 s de boot (29%), e até 259% no Redis no P550. Suportar o CSR de tempo e a extensão Sstc em hardware eliminaria 96,5% dos world switches nos benchmarks de aplicação.
- **Políticas.** Enclaves Keystone rodando o RV8 mostram 1% de overhead médio no VisionFive 2, em linha com o Keystone original. A política ACE roda uma VM confidencial com 1 GB de RAM, mas só no QEMU, então não há comparação de desempenho.
- **Tamanho e verificação.** O Miralis tem 6,2k linhas no total, das quais 190 são o fast path. Os autores verificam 2,7k linhas, 43% do código, com 6,9k linhas do modelo Sail traduzido e 1,1k linhas de provas. O model checking leva de 28 s para o `wfi` a 9 minutos para escritas de CSR e 118 minutos para a emulação de ponta a ponta. Ele achou 21 bugs durante o desenvolvimento, incluindo um overflow do PC virtual, um `mret` incorreto, e três na virtualização de PMP (escritas além do número permitido de entradas, a combinação reservada W=1, R=0 aceita, e um parêntese fora de lugar em uma máscara de legalização).

## Análise crítica

O artigo é franco sobre vários limites. Ele reconhece o seguinte.

- **DMA.** As placas avaliadas não têm IOPMP, então o Miralis só impede o DMA do firmware, e continua vulnerável a acessos de dispositivos iniciados pelo SO.
- **Uma TCB só em parte verificada.** Assembly, drivers de dispositivo e o fast path estão na TCB e não são verificados, nem as políticas de sandbox e Keystone. A política Keystone não tem atestação, e a política ACE foi portada de código verificado.
- **Escopo do modelo de ameaça.** Ataques físicos, negação de serviço, cores auxiliares e execução transiente ficam de fora. O sandbox também confia na documentação do fornecedor sobre CSRs e regiões MMIO específicos da plataforma, e deixa a memória do SO aberta ao firmware até o primeiro salto para o S-mode, quando então trava a memória e calcula o hash da imagem do S-mode.
- **Arm.** O EL3 não é virtualizável, e as correções propostas (paravirtualização ou um novo registrador de trapping) não foram construídas.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **Nenhum teste adversarial.** As perguntas Q1 a Q4 medem compatibilidade, velocidade e suporte a políticas. O argumento de segurança se apoia em raciocínio e verificação, sem nenhuma execução de um firmware deliberadamente malicioso contra o sandbox. Os quatro CSRs não padronizados de especulação são simplesmente permitidos no P550, o que é coerente com excluir ataques do tipo Spectre, mas deixa essa superfície aberta.
- **Base de evidência pequena para "sem overhead".** Duas placas de 4 cores, ambas com firmware derivado do OpenSBI, mais uma terceira placa em que só o firmware fechado foi executado. A distribuição dos traps vem de um único boot de Linux no VisionFive 2. Os resultados são médias de 5 execuções sem dispersão informada, e uma taxa próxima de 0,5 world switch por segundo diz pouco sobre cargas que chamam o firmware com frequência. O artigo motiva o trabalho com RISC-V de classe servidor, mas não avalia nenhuma máquina assim, nem a sincronização de PMP em muitos cores.
- **O fast path carrega parte da alegação.** A introdução o chama de opcional, mas a Q3 conclui que ele deve ficar no VFM nas CPUs atuais, e o "sem degradação" do resumo vale só com ele. O Miralis, portanto, reimplementa o tratamento de timer, IPI, fence e acesso desalinhado em código não verificado, o que combina com "firmware sem modificações", mas aumenta a TCB.
- **A verificação é relativa.** Ela checa o Miralis contra o modelo Sail por meio de um tradutor que os autores escreveram, e o texto não diz como esse tradutor é validado. A execução fiel é mostrada só para loads e stores, e uma execução de ponta a ponta de 118 minutos levanta a questão de reverificar a cada mudança na ISA ou no código. Os 21 bugs não têm uma linha de base do que testes comuns teriam pego.
- **Tamanhos inconsistentes.** A Seção 4.1 e a seção de verificação dão o emulador de instruções como 2,1k linhas (34% do código), enquanto o início da Seção 6 e a Tabela 1 dão 2,7k para o emulador, e 2,7k (43%) também é citado como o total verificado. Os dois números cabem se a linha da tabela incluir outro código verificado, o que o artigo não diz. Esta nota usa a tabela para o total de 6,2k.
- **Comparações afirmadas.** "Drasticamente mais simples que hypervisors" e a alegação de manutenção de O(N+M) contra O(N×M) vêm da experiência dos autores. O Dorami é comparado qualitativamente, e nenhum hypervisor nem port do Dorami é medido. O primeiro estágio de boot aparece na linha confiável da Figura 9, e o texto não diz como o hash da imagem do S-mode é usado.

## Pesquisas futuras

- Um Miralis para Arm, por meio de firmware paravirtualizado ou de um controle de trap em instruções sensíveis na arquitetura, como os autores esboçam.
- Hardware RISC-V de classe servidor com IOPMP, para testar escalabilidade em muitos cores, isolamento de DMA e hardware que torne o fast path desnecessário (RVA23).
- Avaliação adversarial: vulnerabilidades reais de firmware, firmware com fuzzing ou malicioso, e verificação das políticas de sandbox e Keystone e do tradutor de Sail para Rust.
- Estender a execução fiel além de loads e stores e tornar a reverificação incremental, para acompanhar as novas extensões da ISA.
