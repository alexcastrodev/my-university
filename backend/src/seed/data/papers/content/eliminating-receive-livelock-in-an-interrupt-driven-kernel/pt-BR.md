---
title: "Eliminando o livelock de recepção em um kernel orientado a interrupções"
summary: Mogul e Ramakrishnan mostram que um kernel que trata pacotes em prioridade de interrupção entrega cada vez menos conforme a entrada cresce, até zero, e corrigem o problema em um roteador Digital UNIX com polling disparado por interrupção, processamento até a conclusão, realimentação de fila e limite de ciclos de CPU.
researchArea: Sistemas operacionais
keywords: livelock de recepção, kernel orientado a interrupções, polling, sobrecarga, encaminhamento de pacotes, execução até a conclusão, realimentação de fila, escalonamento de CPU
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

A maioria dos sistemas operacionais usa interrupções da interface para escalonar tarefas de rede. Sistemas orientados a interrupções podem oferecer baixo overhead e boa latência com carga baixa, mas degradam muito com taxas de chegada maiores, a menos que se tome cuidado com várias patologias. Elas são formas de livelock de recepção, em que o sistema gasta todo o tempo processando interrupções, com exclusão das outras tarefas necessárias. Em condições extremas, nenhum pacote chega à aplicação do usuário nem à saída do sistema. Para evitar o livelock e problemas relacionados, o sistema operacional deve escalonar o tratamento de interrupções de rede com o mesmo cuidado com que escalona processos. Os autores modificaram uma implementação de rede orientada a interrupções para fazer isso, o que elimina o livelock de recepção sem degradar outros aspectos do desempenho. O artigo apresenta medições que mostram o sucesso da abordagem.

## Visão geral

O artigo foi publicado na USENIX 1996 Annual Technical Conference (San Diego, janeiro de 1996), pelo Western Research Laboratory da DEC e pela AT&T Bell Laboratories. A versão estendida em periódico (ACM TOCS 1997) é outro item e não foi lida aqui. O argumento parte de uma diferença de época. Kernels como o 4.2BSD foram feitos para dispositivos que interrompem a cada poucos milissegundos, e uma interrupção custava só uma fração da CPU. Em 1996, servidores NFS, multicast, multimídia e roteadores podiam gerar pacotes ordens de grandeza mais rápido que um disco gera buscas, e muitos desses protocolos não têm controle de fluxo, então nada freia o remetente.

No 4.2BSD o driver de dispositivo roda em nível de prioridade de interrupção (IPL) alto, enfileira o pacote e levanta uma interrupção de software para o IP em um IPL menor. O escalonador não participa. Com prioridades estritas, quando a taxa de entrada passa do inverso do custo de CPU de tratar um evento de entrada, nada de menor prioridade executa. Os autores chamam isso de livelock de recepção: não é deadlock, pois o sistema se recupera quando a carga cai, mas não há progresso útil enquanto dura. Para trabalhos posteriores do catálogo sobre sobrecarga, veja [Targeted Task Cancellation](/papers/targeted-task-cancellation-for-application-resource-overload), que cita o livelock de recepção como caso clássico, e [Metastable Failures](/papers/metastable-failures-in-distributed-systems), que o separa da sua própria definição.

## Contribuição

O artigo contribui com um modelo do comportamento sob sobrecarga e um conjunto de mudanças de escalonamento.

- **O modelo.** Um sistema ideal entrega tudo o que recebe. Um realizável acompanha a entrada até a Maximum Loss Free Receive Rate (MLFRR) e fica mais ou menos constante acima dela. Um sistema propenso a livelock entrega menos conforme a carga sobe acima da MLFRR, e o livelock é o ponto em que a vazão chega a zero. O agrupamento de interrupções pode aumentar a MLFRR, mas sozinho não evita o livelock.
- **Três patologias.** Livelock de recepção, latência extra para o primeiro pacote de uma rajada e inanição da transmissão quando ela roda em prioridade menor que a recepção.
- **Técnicas.** Usar interrupções só para iniciar o polling. Fazer polling round-robin com cota por callback. Desabilitar a entrada quando uma fila adiante está cheia ou quando o processamento de pacotes usa CPU demais. Descartar cedo, na interface, e processar até a conclusão cada pacote aceito. Reabilitar as interrupções quando não há trabalho pendente.

## Metodologia

A bancada é um roteador IP sobre Digital UNIX V3.2 (um DECstation 3000/300 Alpha, SPECint92 66,2, o Alpha mais lento disponível, escolhido para tornar o livelock visível) entre duas Ethernets sem outra carga. Um host de origem envia 10000 pacotes UDP com 4 bytes de dados em várias taxas para um destino inexistente (uma entrada ARP fantasma), e a taxa entregue é lida no contador da interface de saída com `netstat`. Os autores conferiram essa contagem com um analisador de rede. Cada tentativa é uma marca nos gráficos, e as taxas são médias de vários segundos.

O kernel modificado faz o tratador de interrupção escalonar uma thread de polling e deixar a interrupção do dispositivo desabilitada. A thread chama os callbacks de cada driver registrado com uma cota de pacotes, chama a entrada do IP diretamente (sem fila de entrada do IP) e reabilita as interrupções quando nada está pendente. Eles também testam com o `screend`, um programa de firewall em modo usuário que faz uma chamada de sistema por pacote. A realimentação de fila e o limite de ciclos de CPU são acrescentados passo a passo.

## Resultados

- **Kernel sem modificação.** Com `screend`, comportamento ruim acima de 2000 pacotes/s e livelock completo em cerca de 6000. Sem `screend`, pico de 4700 pacotes/s e depois queda. A taxa máxima da Ethernet é cerca de 14.880 pacotes/s, e os autores dizem que o livelock provavelmente começaria um pouco abaixo dela.
- **Polling com cota 5 (sem screend).** A curva da Figura 6-3 fica estável em cerca de 5000 pacotes/s com a entrada passando de 10000 (leitura do gráfico). Sem cota, a vazão cai quase a zero, porque os pacotes se acumulam e são descartados na fila de saída e a transmissão sofre inanição.
- **Realimentação com screend.** Com fila de triagem de 32 pacotes, entrada inibida com a fila 75% cheia e reabilitada com 25% (mais um timeout de um tick de clock, cerca de 1 ms), não há livelock e o pico é bem maior. A Figura 6-4 mostra cerca de 2800 pacotes/s, estável. O polling sem realimentação se comporta quase tão mal quanto o kernel sem modificação.
- **Cota.** Menor é melhor sem `screend`. A Figura 6-5 mostra cota 10 perto de 4300 a 4500 e cota 20 perto de 2200 a 2500 acima do pico (leitura do gráfico). Com `screend`, cotas pequenas custam cerca de 5% do máximo. Os autores concluem que 10 a 20 pacotes é quase ótimo para este hardware e que o valor deve ser ajustável.
- **Progresso do usuário.** Só com polling e realimentação, um processo limitado por CPU não fez progresso mensurável sob inundação. Com o limite de ciclos (período de 10 ms, limiar como fração dos ciclos), ele recebe cerca de 94% da CPU sem entrada e uma fatia estável sob carga. A Figura 7-1 mostra cerca de 65%, 44% e 15% para limiares de 25%, 50% e 75%, abaixo do que o limiar sugere (leitura do gráfico). Os autores atribuem a diferença a overhead e ao trabalho de saída não ser limitado.

## Análise crítica

O que o artigo não afirma. Ele mede uma única aplicação: um roteador em um Alpha lento, com Ethernet e pacotes UDP de 4 bytes. Monitoramento de rede e servidores NFS aparecem como aplicações motivadoras que também foram corrigidas e entregues, mas o texto não traz medições delas. O desempenho de TCP e da pilha NFS não foi medido porque o código modificado ainda não estava em um driver de interface rápida (FDDI). A realimentação para a fila do filtro de pacotes e para a fila de saída é só sugerida. Os limites alto e baixo foram escolhidos de forma arbitrária, o limite de CPU não tinha interface de programação (uma variável do kernel alterada à mão) e o Telnet interativo ainda sofre porque pacotes são descartados. A mudança só altera quando os pacotes são descartados, não quais, e a política continua sendo drop-tail. O kernel modificado configurado como o original ficou um pouco pior que o original, por razões que os autores dizem não estar claras.

Literatura posterior, marcada como tal e não lida para esta entrada. A documentação do kernel Linux sobre NAPI (lida, docs.kernel.org/networking/napi.html) descreve a mesma forma: o tratador de interrupção do driver escalona um poll, as interrupções ficam mascaradas até o polling terminar, o método de poll tem um orçamento de pacotes e as interrupções só são desmascaradas depois que o poll conclui. Essa página não menciona este artigo, então a linhagem é inferência minha, não fato declarado. Os itens do catálogo sobre [IX](/papers/ix-protected-dataplane-operating-system) (lotes limitados executados até a conclusão, agrupamento só sob congestionamento), [Snap](/papers/snap-microkernel-approach-to-host-networking), [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) e [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) tiram o processamento de pacotes do caminho de interrupção do kernel, cada um à sua maneira, segundo os resumos do catálogo. Não verifiquei se eles citam este artigo. Livro versus hoje: NICs de gigabit ou mais rápidas, vários núcleos e receive-side scaling mudam a conta, e o modelo de CPU única daqui não os cobre.

## Pesquisas futuras

- Realimentação do estado de fila para outras filas (saída, filtro de pacotes), onde o artigo diz que as políticas são mais difíceis porque a carga pode não ser o que bloqueia o progresso.
- Ajuste da cota e dos limites alto e baixo para outras CPUs e interfaces, que os autores deixam em aberto.
- Uma interface de programação para o limite de CPU e a medição de TCP e NFS com um driver de alta velocidade.
- Escalabilidade em vários núcleos das mesmas ideias: veja [Analysis of Linux Scalability](/papers/analysis-of-linux-scalability-to-many-cores) para o que limita os caminhos de rede do kernel em muitos núcleos.
- Escalonamento do trabalho de pacotes dentro do kernel para cargas de RPC modernas: [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs).
