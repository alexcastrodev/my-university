---
title: "Firecracker: virtualização leve para aplicações serverless"
summary: O Firecracker mantém o KVM, mas troca o QEMU por um VMM mínimo em Rust que emula poucos dispositivos virtio e roda um processo isolado por microVM, dando ao AWS Lambda e ao Fargate isolamento em nível de hardware com baixo consumo de memória e boot rápido.
researchArea: Sistemas operacionais
keywords: microVM, monitor de máquina virtual, KVM, serverless, virtio, seccomp, jailer, multilocação, sobrecarga de memória, tempo de boot
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Contêineres e funções serverless são muito usados para implantar e gerenciar software na nuvem. A popularidade vem do menor custo operacional, do melhor aproveitamento do hardware e de um escalonamento mais rápido que o dos métodos tradicionais de implantação. A economia e a escala das aplicações serverless exigem que cargas de vários clientes rodem no mesmo hardware com sobrecarga mínima, preservando forte isolamento de segurança e de desempenho. A visão tradicional é que se escolhe entre virtualização, com segurança forte e sobrecarga alta, e tecnologias de contêiner, com segurança mais fraca e sobrecarga mínima. Esse compromisso é inaceitável para provedores de infraestrutura pública, que precisam de segurança forte e sobrecarga mínima ao mesmo tempo. Para atender essa necessidade, desenvolvemos o Firecracker, um novo monitor de máquina virtual (VMM) de código aberto, especializado em cargas serverless mas útil em geral para contêineres, funções e outras cargas de computação dentro de um conjunto razoável de restrições. Implantamos o Firecracker em dois serviços serverless públicos da Amazon Web Services (Lambda e Fargate), onde ele sustenta milhões de cargas em produção e trilhões de requisições por mês. Descrevemos como a especialização em serverless moldou o projeto do Firecracker e o que aprendemos ao migrar os clientes do Lambda para ele sem interrupção.

## Visão geral

Este artigo do NSDI 2020 (os oito autores trabalham na Amazon Web Services) parte de um dilema. Contêineres Linux (cgroups, namespaces, seccomp-bpf) empacotam muitas cargas em um host, mas compartilham um único kernel, então a segurança é comprada restringindo syscalls, ao custo de compatibilidade. A virtualização com hipervisor isola melhor, porém o VMM e o kernel convidado consomem memória e tempo de boot antes de qualquer trabalho útil. O primeiro Lambda isolava funções com contêineres e contas de clientes com VMs, e os autores não ficaram satisfeitos: trocava segurança por compatibilidade e empacotava mal as cargas em VMs de tamanho fixo.

O artigo lista seis critérios para a substituição: isolamento, sobrecarga e densidade, desempenho, compatibilidade (binários Linux arbitrários, sem modificação), troca rápida e alocação flexível (overcommit). Compara contêineres, isolamento por VM de linguagem e virtualização, e escolhe a virtualização. A decisão se alinha à linhagem do [Xen](/papers/xen-and-the-art-of-virtualization), que o artigo cita como opção de hipervisor e que tem um autor em comum com este, Rolf Neugebauer. A motivação lembra a do [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) e a do [seL4](/papers/sel4-formal-verification-of-an-os-kernel) (reduzir o que precisa ser confiável), mas o artigo não cita nenhum dos dois; cita Muen e NOVA como hipervisores minimizados anteriores que não tinham a independência de plataforma, a operação e a maturidade de que a AWS precisava.

## Contribuição

A contribuição é um projeto, uma implementação de código aberto (Apache 2, liberada em dezembro de 2018) e experiência operacional, não um algoritmo novo.

- **Manter o KVM, trocar o QEMU.** O QEMU tem mais de 1,4 milhão de linhas, mais de 40 dispositivos emulados e pode precisar de até 270 syscalls; o KVM soma cerca de 120 mil linhas. O Firecracker tem cerca de 50 mil linhas de Rust (96% menos que o QEMU), nasceu do crosvm do Google e tem menos da metade das linhas dele.
- **Modelo de dispositivos mínimo.** Rede e disco por virtio, portas seriais e suporte parcial ao i8042. O código do virtio de bloco tem cerca de 1400 linhas. O armazenamento é um dispositivo de bloco, não passagem de sistema de arquivos, para manter uma base de código grande fora da exposição do host.
- **Reutilizar o Linux.** A E/S de bloco vai para o kernel do host, o Linux escalona e gerencia memória entre as VMs, e a rede usa TUN/TAP. Isso sacrifica a portabilidade entre sistemas hospedeiros e herda uma base confiável maior, mas os operadores mantêm suas ferramentas (ps, top, kill).
- **Jailer e seccomp.** O jailer coloca o VMM em um chroot e em namespaces de pid e de rede, descarta privilégios e aplica um perfil seccomp-bpf que libera 24 syscalls (com filtro de argumentos) e 30 ioctls.
- **API REST sobre um socket Unix** para configurar, iniciar e parar uma MicroVM, mais limitadores de taxa (token bucket) para disco e rede. Roda um processo Firecracker por MicroVM.

## Metodologia

O artigo tem duas partes. A Seção 4 descreve o Lambda: um frontend, um Worker Manager que roteia eventos, um serviço Placement que concede slots por lease e um MicroManager por worker, com uma MicroVM por slot contendo uma única função de cliente e um shim. Um slot vive no máximo 12 horas. Os autores descrevem a migração do Lambda para o Firecracker em instâncias bare metal do EC2 (usuários internos da AWS primeiro, métricas separadas para a pilha antiga e a nova, rollback rápido, correções por reimagem dos hosts).

A Seção 5 mede o Firecracker v0.20.0 contra o QEMU v4.2.0 (build mínimo, BIOS qboot) e o Cloud Hypervisor da Intel em uma EC2 m5d.metal (dois Xeon Platinum 8175M, 48 núcleos, hyper-threading desligado, 384GB, quatro NVMe de 840GB, Ubuntu 18.04.2, kernel 4.15.0-1044-aws). Os testes de boot usam um convidado Linux 4.14.94 com 1 vCPU e 256MB, medindo do fork do VMM até o init do convidado. Os testes de E/S usam 2 vCPUs e 512MB, fio com E/S direta para disco e iperf3 sobre uma interface tap para rede. Dados e scripts são públicos (nsdi2020-data).

## Resultados

Todos os números são dos próprios autores.

- **Alegações principais** (com o kernel convidado mínimo recomendado): sobrecarga de memória abaixo de 5MB por contêiner, boot até o código da aplicação em menos de 125ms e criação de até 150 MicroVMs por segundo por host. O número de 150 por segundo aparece na introdução; não encontrei um experimento dedicado a ele na Seção 5.
- **Boot.** Em 500 boots seriais, o Firecracker pré-configurado (chamadas de API feitas antes) e o Cloud Hypervisor dão boot cerca de duas vezes mais rápido que o QEMU, e o Firecracker ponta a ponta fica no meio. Com 1000 MicroVMs iniciadas 50 por vez, o percentil 99 do Firecracker pré-configurado é 146ms contra 158ms do Cloud Hypervisor, e 153ms com 100 inícios concorrentes. O kernel padrão do Ubuntu 18.04 soma cerca de 900ms, e uma interface de rede soma cerca de 20ms (35ms no QEMU).
- **Sobrecarga de memória**, constante independente do tamanho da VM: cerca de 3MB no Firecracker, 13MB no Cloud Hypervisor e 131MB no QEMU. A Seção 5.4 fala em sobrecarga de memória tão baixa quanto 3% e desprezível em CPU.
- **E/S de bloco.** Leituras de 4kB ficam só 49 microssegundos acima das nativas com fila de profundidade 1, mas E/S de 128kB mais que dobra a latência. O convidado fica limitado a cerca de 13 mil IOPS (52MB/s a 4kB) contra mais de 340 mil IOPS do hardware, porque a E/S é tratada em série e não há flush para disco, então a velocidade de escrita custa durabilidade.
- **Rede.** O iperf3 mostra cerca de 15Gb/s no Firecracker contra 44 a 46Gb/s do host e 20 a 23Gb/s do Cloud Hypervisor. Até 16 MicroVMs concorrentes mantiveram a mesma banda.
- **Densidade.** Cada worker roda centenas ou milhares de MicroVMs. Os autores testaram oversubscription de CPU e memória acima de 20x e operam em produção até 10x. Com criação em 125ms, é preciso uma MicroVM no pool para cada 8 criações por segundo (lei de Little).

## Análise crítica

O que o artigo não afirma: não oferece prova formal de segurança nem avaliação de ataques, só um argumento em camadas (virtualização em hardware, Rust, testes, jailer, endurecimento do host). Canais laterais de energia e temperatura ficam explicitamente a cargo de quem implanta. Não há passagem de dispositivos: o artigo diz que o virtio não chega ao desempenho quase nativo da passagem PCI usada nas instâncias EC2 comuns. Não há migração, BIOS, PCI nem emulação de dispositivos legados, e ele não bootaria o Windows sem mudanças significativas. Os convidados são Linux e OSv. Não é um orquestrador: substitui o QEMU, não o Docker nem o Kubernetes. Não há um número único de densidade por host, e os autores reconhecem as limitações da E/S. A história de Lambda e Fargate só é contada em detalhe para o Lambda.

As comparações são contra um QEMU enxugado em build mínimo e um VMM em Rust que divide código com o Firecracker; os autores escolheram as duas configurações, e os resultados de E/S do Firecracker trocam durabilidade por velocidade. O projeto também depende do Linux para escalonamento e memória, enquanto o próprio artigo cita o estudo dos [núcleos desperdiçados](/papers/linux-scheduler-decade-of-wasted-cores) como crítica a esse escalonador, então a qualidade do kernel do host continua fazendo parte da história do isolamento.

Literatura posterior, não lida por inteiro aqui e posterior a 2020: o verbete do catálogo sobre o [Dirigent](/papers/dirigent-lightweight-serverless-orchestration) relata o uso do Firecracker com e sem snapshots. Ustiugov et al., "Benchmarking, Analysis, and Optimization of Serverless Function Snapshots" (ASPLOS 2021), li apenas como resumo: estuda tirar snapshot de uma função já iniciada para reduzir cold starts. Du et al., "Catalyzer" (ASPLOS 2020), foi visto só pelos metadados. Brooker et al., "On-demand Container Loading in AWS Lambda" (USENIX ATC 2023), li como resumo: trata de entregar imagens de contêiner ao Lambda sob demanda. O artigo cita Kata Containers, gVisor e Cloud Hypervisor; como evoluíram depois não foi verificado.

## Pesquisas futuras

- Aumentar a densidade sem perder isolamento, em especial deduplicação de memória, dados os riscos de canais laterais que o artigo lista. O [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) descreve compartilhamento de páginas por conteúdo e ballooning para overcommit de memória (o artigo do Firecracker não o cita, e ele desativa o samepage merging como mitigação).
- Reduzir ainda mais o custo de início e de troca de carga: uma única chamada de API combinada, alocando memória e carregando o kernel durante a configuração.
- E/S de bloco paralela, suporte a flush e rede virtio mais rápida.
- Hardware para multilocação de alta densidade, bypass do host para rede, armazenamento e aceleradores, e uma base confiável de virtualização menor.
- Escalonadores que aproveitem o isolamento das MicroVMs, e sistemas operacionais e modelos de programação alternativos para serverless. Veja também o [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) e o [IX](/papers/ix-protected-dataplane-operating-system) para caminhos de E/S que contornam o kernel com virtualização em hardware.
