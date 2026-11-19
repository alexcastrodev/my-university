---
title: "Gerenciamento de recursos de memória no VMware ESX Server"
summary: Waldspurger descreve como o VMware ESX Server faz overcommit de memória entre máquinas virtuais que rodam sistemas convidados sem modificação, combinando ballooning, compartilhamento de páginas por conteúdo, um imposto sobre memória ociosa nas cotas proporcionais e paginação do hipervisor como último recurso.
researchArea: Sistemas operacionais
keywords: vmware esx server, overcommit de memória, ballooning, compartilhamento de páginas por conteúdo, imposto sobre memória ociosa, alocação proporcional, paginação do hipervisor
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O VMware ESX Server é uma camada de software fina, projetada para multiplexar recursos de hardware com eficiência entre máquinas virtuais que rodam sistemas operacionais comuns sem modificação. Este artigo apresenta vários mecanismos e políticas novos do ESX Server para gerenciar memória. Uma técnica de ballooning recupera as páginas que o sistema operacional da máquina virtual considera menos valiosas. Um imposto sobre memória ociosa obtém uso eficiente de memória mantendo garantias de isolamento de desempenho. O compartilhamento de páginas por conteúdo e o remapeamento de páginas de E/S "quentes" exploram o remapeamento transparente de páginas para eliminar redundância e reduzir custos de cópia. Essas técnicas são combinadas para suportar com eficiência cargas de máquinas virtuais que fazem overcommit de memória.

## Visão geral

O artigo foi apresentado no OSDI 2002 (Boston, 9 a 11 de dezembro), pela VMware. Ele pertence à onda de consolidação de servidores do início dos anos 2000: muitos servidores pouco usados viram máquinas virtuais em um único host, e o administrador quer fazer overcommit de memória, ou seja, a memória configurada para todas as VMs soma mais do que a máquina tem. O difícil é que o ESX Server rodava Windows 2000 e Red Hat Linux 7.2 sem modificação, então não podia perguntar ao convidado o que ele fazia com suas páginas. O melhor conhecimento sobre qual página vale menos está dentro do convidado.

Termos: um número de página "física" (PPN) é o que o convidado acha que é hardware, e um número de página de máquina (MPN) é o quadro real; o ESX mantém um pmap por VM e tabelas de páginas sombra. Vale saber antes: paginação por demanda, substituição de páginas, copy-on-write e TLB. Os pareamentos abaixo são meus. O [Xen](/papers/xen-and-the-art-of-virtualization) (SOSP 2003) segue o caminho oposto, com convidado modificado, e atribui seu driver de balão a este artigo. O [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) é o outro clássico sobre quem decide sobre páginas físicas. O [Slab Allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator) é o tipo de alocador do kernel convidado cuja pressão o ballooning provoca, embora este artigo não o mencione. O próprio artigo se apoia em Disco, Cellular Disco e Nemesis, que não estão no catálogo.

## Contribuição

- **Ballooning.** Um módulo pequeno carregado no convidado como pseudo-driver de dispositivo. O servidor manda inflar (alocar páginas fixadas do convidado) ou desinflar, então a política de substituição do próprio convidado escolhe as vítimas, paginando para o disco virtual dele se preciso.
- **Compartilhamento de páginas por conteúdo.** Páginas são identificadas por um hash do conteúdo, depois confirmadas por comparação completa e mapeadas como copy-on-write. Sem mudar o convidado, ao contrário dos ganchos de que o Disco precisava.
- **Imposto sobre memória ociosa.** A revogação min-funding ganha uma razão ajustada de cotas por página, rho = S / (P (f + k (1 - f))), com k = 1/(1 - tau). Uma página ociosa custa k vezes uma ativa.
- **Estimativa estatística do conjunto de trabalho.** Amostragem aleatória de poucas páginas por VM, sem participação do convidado, alimenta o imposto.
- **Uma política de alocação dinâmica.** Parâmetros min, max e cotas, controle de admissão, quatro limiares de memória livre, ballooning primeiro e paginação como alternativa.
- **Remapeamento de páginas de E/S quentes**, que tira da memória alta as páginas usadas em E/S repetida para evitar cópias por buffer intermediário em sistemas IA-32 com muita memória.

## Metodologia

O sistema é o ESX Server 1.5 em IA-32. A avaliação usa experimentos pequenos em várias máquinas: um Dell Precision 420 com dois Pentium III de 800 MHz para ballooning, amostragem e imposto; um Dell PowerEdge 1400SC com dois processadores de 933 MHz para compartilhamento de páginas; um IBM Netfinity 8500R com oito processadores de 550 MHz para realocação dinâmica. As cargas são dbench com 40 clientes, SPEC95 em VMs Linux idênticas, um programa "toucher" no Windows e uma mistura de cinco VMs com Windows 2000 (Exchange, Citrix MetaFrame, SQL Server). O compartilhamento também é medido em três implantações de produção. Não há comparação com outros monitores de VMs e não há barras de variância além da média de três execuções do ballooning.

## Resultados

Todos os números abaixo são do próprio artigo.

- **Ballooning contra uma VM configurada menor (Figura 2).** Uma VM Linux de 256 MB reduzida por balão acompanha uma VM configurada nesse tamanho, com sobrecusto de 4,4% em 128 MB (balão de 128 MB) até 1,4% em 224 MB. O artigo atribui isso a estruturas do convidado dimensionadas pela memória "física". O artigo não faz uma comparação direta de ballooning com a paginação do ESX; só diz que o balão é preferido e a paginação é a alternativa.
- **Compartilhamento, melhor caso (Figura 4).** VMs Red Hat 7.2 idênticas de 40 MB rodando SPEC95, de uma a dez. O compartilhamento chega perto de 67% da memória das VMs e quase 60% é recuperado. Uma única VM já rende quase 5 MB, cerca de 55% de páginas zero. A vazão com compartilhamento foi 0,5% maior no total (de 1,6% menor a 1,8% maior). Os metadados custam menos de 0,5% da memória.
- **Compartilhamento em produção (Figura 5).** Dez VMs Windows NT, 2048 MB: 880 MB compartilhados (42,9%), 673 MB recuperados (32,9%). Nove VMs Linux, 1846 MB: 539 MB (29,2%) e 345 MB (18,7%). Cinco VMs Linux, 1658 MB: 165 MB (10,0%) e 120 MB (7,2%). O artigo diz que cargas mais variadas compartilham menos.
- **Imposto sobre memória ociosa (Figura 7).** Duas VMs com cotas iguais e 256 MB cada, uma Windows ociosa e uma Linux com dbench. Com tau = 0%, as duas estabilizam em 179 MB. Subir tau para 75% (o padrão) tira memória da VM ociosa e aumenta a vazão do dbench em mais de 30%. O amostrador padrão usa 100 páginas a cada 30 segundos.
- **Realocação dinâmica (Figura 8).** Cinco VMs em 1 GB utilizável, configuradas para 1472 MB mais 160 MB de sobrecarga, com overcommit acima de 60%. No boot, 325 MB de páginas zero são recuperados por compartilhamento e 35 MB vão para o disco; depois, menos de 20 MB são paginados. O compartilhamento economiza cerca de 200 MB ao longo da execução, e a VM do SQL Server cai para o mínimo de 160 MB quando ociosa.
- **Remapeamento de E/S.** Em algumas cargas intensivas de rede, o número de páginas copiadas cai em várias ordens de grandeza; o artigo não traz tabela para isso.

## Análise crítica

O desenho central convence: usar a política do próprio convidado quando possível (ballooning), usar hash de conteúdo quando o convidado não coopera e manter a paginação como rede de segurança rara. Limites e lacunas do próprio artigo:

- **Experimentos pequenos e de um só fornecedor.** Uma máquina por experimento, execuções curtas e nenhuma comparação com outro hipervisor.
- **Compartilhamento no melhor caso.** Os 67% são de VMs Linux idênticas; nos casos de produção a recuperação vai de 7,2% a 32,9%.
- **O imposto é uma heurística com padrão global.** tau = 75% vale para todas as VMs, e o artigo diz que taxas por VM existem na implementação mas não são expostas.
- **O ballooning tem limites que o artigo declara:** o driver pode estar desinstalado, indisponível durante o boot ou lento demais, e por isso a paginação existe. No boot das cinco VMs, a paginação foi forçada exatamente por esse motivo.
- **Não afirmado:** nenhuma análise de segurança do compartilhamento de páginas, nenhuma medição do problema de paginação dupla que ele descreve, nada de migração ao vivo e nada de compressão de memória.

Literatura posterior (não faz parte do artigo, conferida nas fontes citadas). A base de conhecimento da VMware (artigo 2080735) diz que, por cautela, as atualizações do ESXi deixaram de habilitar por padrão o compartilhamento de páginas entre VMs, e que ele não é habilitado por padrão a partir do ESXi 6.0; o artigo não cita pesquisa. O guia de boas práticas de desempenho do vSphere 8.0 afirma que o ESXi não compartilha páginas grandes de 2 MB, então com páginas grandes o compartilhamento pode só ocorrer quando o overcommit for alto o bastante. A documentação do kernel Linux descreve o KSM (desde o 2.6.32, desenvolvido originalmente para o KVM) como um scanner de memória registrada com madvise(MADV_MERGEABLE), que funde apenas páginas anônimas. O artigo do Firecracker (NSDI 2020) lista deduplicação de memória sem perder isolamento contra canais laterais como direção em aberto, e o repositório do Firecracker documenta um dispositivo virtio balloon com deflate-on-OOM e free page reporting. O hot-add era só uma ideia futura aqui (placas de memória conectáveis); não conferi trabalhos posteriores sobre ele, e não li o artigo de 2015 da VMware sobre quebrar páginas grandes de forma proativa, que só vi em uma listagem de busca.

## Pesquisas futuras

- Quando o compartilhamento de páginas vale o risco de canal lateral, e como compartilhar sem sinal de tempo entre inquilinos.
- Conciliar páginas grandes (menos faltas de TLB) com compartilhamento e overcommit.
- Estimadores de ociosidade melhores que 100 páginas aleatórias a cada 30 segundos, e taxas de imposto por VM ou graduadas, como os autores sugerem.
- Trade-offs entre vários recursos, abstrações de agrupamento de VMs e gerenciamento de cargas por realimentação, todos listados nas conclusões do artigo.
- Interfaces de memória cooperativas com o convidado (memória hot-plug, free page reporting) para microVMs e contêineres.
