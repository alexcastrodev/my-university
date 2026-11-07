---
title: "Xkernel: ajustabilidade de desempenho fundamentada em princípios para kernels de sistemas operacionais"
summary: O Xkernel torna as constantes de desempenho fixas de um kernel Linux em execução alteráveis por políticas em eBPF em milissegundos, sintetizando pequenos trechos de atualização de estado onde cada constante entra no estado da máquina e aplicando a atualização só quando nenhuma thread ainda carrega efeitos do valor antigo.
researchArea: Sistemas operacionais
keywords: ajuste de kernel, perf-const, scoped indirect execution, ebpf, kprobe, live patching, segurança de efeitos colaterais
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

O Linux está cheio de constantes numéricas que moldam o desempenho: limiares, intervalos, tamanhos de lote e fatores de escala, escritos como macros, literais e inteiros estáticos. Os autores as chamam de perf-consts. Seus valores muitas vezes foram escolhidos por regra prática, no hardware da época, e depois que o kernel é compilado eles não mudam. As saídas usuais ficam ambas aquém. Transformar uma constante em um knob de sysctl ou sysfs exige uma mudança no código-fonte para cada uma, e o live patching exige uma recompilação que leva minutos.

Este artigo do OSDI 2026 (a 20ª edição, realizada em Seattle), da Tsinghua University, da Microsoft Research e da University of Illinois Urbana-Champaign, defende a ajustabilidade de desempenho fundamentada em princípios: atualizações seguras, rápidas e programáveis de qualquer perf-const em um kernel já implantado, sem recompilar e sem reiniciar.

Os termos centrais são Scoped Indirect Execution (SIE), o mecanismo; critical span (CS) e safe span (SS), as duas regiões do binário sobre as quais o SIE raciocina; Xk-tune, um programa de política escrito em eBPF; e Xkernel, a implementação para Linux.

Vale conhecer antes: kprobes e eBPF, como o live patching de kernel (kpatch, KLP) troca funções inteiras e a ideia básica de execução simbólica. Para outra forma de mudar a política do kernel sem reiniciar, veja o [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), que delega decisões de escalonamento a agentes em espaço de usuário por uma interface dedicada do kernel, enquanto o Xkernel mira constantes de qualquer subsistema. Os trabalhos relacionados do Xkernel citam sched_ext, Syrup e PlugSched sobre escalonamento, não o ghOSt.

## Contribuição

- **Uma meta com cinco requisitos.** Ajuste in-situ transparente em kernels implantados, políticas programáveis em granularidade flexível (um cgroup, um dispositivo, um fluxo), cobertura de qualquer perf-const, atualizações em escala de milissegundos com baixo overhead e segurança durante o ajuste.
- **Critical span.** É a região do binário em que uma constante entra pela primeira vez em registradores ou memória. O Xkernel recompila o kernel com outro valor e compara os binários para achar as instruções semente, depois roda execução simbólica para obter uma expressão de estado que vale apesar de truques do compilador, como constant folding e strength reduction. Um ajuste linear sobre compilações extras leva o valor transformado de volta ao valor do código-fonte.
- **Indireções em vez de patches.** O Xkernel não reescreve instruções. Ele sintetiza pares `{location, update}`: código compilado em JIT, alcançado por um kprobe, que sobrescreve o estado afetado como se o novo valor tivesse sido usado. Se o span sobrescreve esse estado, a atualização roda a lógica inversa quando a operação é reversível e, caso contrário, captura o valor original antes e o restaura depois. O binário do kernel permanece intocado.
- **Safe span e segurança de efeitos colaterais.** Um thin slicing para frente a partir do critical span encontra toda instrução que consome dados derivados da constante. A atualização só é aplicada quando nenhuma thread está dentro do safe span, o que vai além da atomicidade de versão por função do live patching. Para consistência global, uma transição autoconvergente chama stop_machine uma única vez para inicializar contadores de referência, e kprobes de entrada e de saída os mantêm atualizados até chegarem a zero. Um timeout configurável reporta a falha.
- **Plano de política programável.** Um Xk-tune usa `xk_set` e `xk_transition_done`, e suas escritas no estado do kernel passam por um único kfunc, `sie_write_kernel`. Várias perf-consts podem ser agrupadas em uma transação atômica, e as ferramentas são xk-build, xk-gen, xk-load e xk-unload.

## Metodologia

O runtime tem cerca de 1,7K linhas de C de kernel. O toolchain tem cerca de 11K linhas de Python, das quais cerca de 5K fazem a análise de spans, além de um passe de LLVM para o safe span. Para manter o custo do kprobe baixo, o Xkernel explora boosting e jump optimization, e acrescenta uma otimização para constantes usadas em saltos condicionais.

A máquina de avaliação, do CloudLab, tem uma Xeon Gold 5512U de 28 núcleos, 128 GB de RAM e dois SSDs NVMe, e alguns estudos de caso usaram outro hardware, como um HDD SAS e um cluster de 4 nós com 25 Gbps. Cinco estudos de caso cobrem a camada de blocos, o tratamento de softirq, a recuperação de slab, a migração de páginas e as constantes de HyStart do TCP CUBIC. A generalidade foi testada em 140 perf-consts de quatro subsistemas. O overhead foi medido com microbenchmarks e com o Redis sob cargas YCSB e Facebook ETC, e o tempo de transição foi comparado com o KLP do Linux em uma constante de backlog do TCP com 128 fluxos do iperf3. Um estudo-piloto examinou 702 knobs de sysctl no Ubuntu 24.04.

## Resultados

Estes são os resultados relatados pelos autores.

- **Potencial de ajuste.** Subir BLK_MAX_REQUEST_COUNT de 32 para 128 em um HDD dá 7× (leitura) e 54× (escrita) em uma carga de FIO sequencial embaralhada. Baixá-la para 1 no RocksDB em NVMe dá 1,2× de throughput e latência P50 e P75 1,37× e 1,41× menores. No NGINX, uma política seletiva para o CUBIC reduz o tempo de conclusão de fluxo em 81% no P99,99 para fluxos de RTT longo e mantém paridade nos curtos.
- **Cobertura.** O Xkernel suporta 139 de 140 constantes (99,3%). A falha é uma constante do btrfs, porque o símbolo que a contém tem várias definições e o registro do kprobe é rejeitado. As 140 constantes têm 367 critical spans, 48% das constantes têm um só e 86% têm menos de cinco. Em 82 spans o valor transformado difere do valor do código-fonte, todos foram recuperados, e três precisaram da forma de dupla localização.
- **Tamanho dos spans.** Os 300 safe spans têm mediana de 10 instruções, e o maior tem cerca de 8K.
- **Custo por disparo.** Um caminho `vfs_write` de base leva 946 ciclos, e o Xkernel completo acrescenta 25% com probes otimizados por salto (84,2% dos spans). Com probes INT3, acrescenta 196%.
- **Taxa de disparo e número de probes.** A lentidão é de 15% para operações que não fazem trabalho, 5% com 5 µs de trabalho, 2% com 10 µs e abaixo de 1% com 20 µs. No Redis, 32 probes custam no máximo 4% de throughput, e 128 probes custam de 7% a 14%.
- **Tempo de atualização e de transição.** Carregar uma política leva 2,7 ms contra 24 ms do KLP, que ainda precisa de 7 minutos para gerar o patch. A transição ponta a ponta mediana é de 2,8 ms contra 30,4 ms. A pior carga mostrada é de 542 ms (15 safe spans), as transições por thread com segurança de efeitos colaterais ficam abaixo de 10 ms, e a consistência global chega a 144 ms com 16 threads.
- **Custo offline.** Em média, 18 minutos por constante, e para N constantes a scope table exige 2N recompilações.
- **Piloto de sysctl.** Dos 145 knobs de desempenho, 96 não mudam desde 2005, 20 precisaram de correções de bugs depois da conversão (12 anos em média) e outros 43 parecem ter bugs.

## Análise crítica

A ideia é elegante: constantes têm uma estrutura que código arbitrário não tem, e o artigo a aproveita bem. Ele é franco sobre o escopo e admite vários limites.

- **Constantes que mudam o layout ficam de fora.** Tamanhos de arrays e padding de structs são rejeitados, assim como constantes removidas por eliminação de código morto.
- **A segurança se apoia principalmente em dependências de dados.** Os safe spans são thin slices. Os autores dizem que isso basta para "a maioria" das perf-consts, sem dar um número, e deixam a análise de fluxo de controle como extensão plugável.
- **Os resultados offline ficam presos a uma compilação.** A scope table depende do código-fonte exato, da versão do compilador e da configuração, e precisa ser regenerada depois de uma atualização de kernel, módulo ou driver.
- **A política está fora do escopo.** O artigo não escolhe valores, não impõe limites a eles e reporta a transição como falha se o caminho de código nunca roda ou se uma thread permanece dentro de um span.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Os estudos de caso mostram potencial, não um otimizador.** Cada resultado vem de uma varredura manual ou de uma política escrita à mão, em uma carga e um dispositivo, como um único SSD no ganho de 1,2× do RocksDB. Nenhum compara com a alternativa existente mais próxima (uma mudança no código-fonte que exponha a constante, ou o TCP-BPF no caso do CUBIC), então o ganho é apenas sobre o valor padrão.
- **A segurança é argumentada, não testada.** A avaliação mede spans, overhead e tempo de transição. Não encontrei um experimento em que uma atualização ingênua quebre e o SIE não, nem injeção de falhas contra um safe span. O texto não diz como as 140 constantes foram escolhidas, nem quantas rodaram sob uma carga.
- **"Escala de milissegundos" cobre uma faixa ampla.** A carga mediana é de 2,7 ms, mas um caso leva 542 ms. A comparação com o KLP usa uma constante e deixa de fora 7 minutos de geração do patch, o que favorece o KLP, então a diferença de cerca de 10× é conservadora.
- **Os probes ficam.** A indireção roda a cada execução do span enquanto o Xk-tune está carregado, então o custo por disparo de 25% a 196% (medido em um caminho de kernel deliberadamente curto) é pago continuamente. O teste com o Redis vai até 128 probes, mas o artigo não diz quantos uma implantação real precisaria.
- **Segurança e contabilidade ficam em aberto.** Um kfunc permite que o eBPF escreva no estado do kernel, mas não encontrei discussão sobre quem pode carregar um Xk-tune. Dois números também divergem: os probes otimizados por salto são 84,2% na §6.2 e 88,3% no Apêndice B, e são verificados 145 e 149 knobs de sysctl. O texto traz as medianas do KLP e do Xkernel em ordem trocada, mas os rótulos da figura resolvem a dúvida.

## Pesquisas futuras

- Políticas que escolham valores: agentes de LLM ou otimizadores de ML conduzindo Xk-tunes, o que os autores convidam, além de limites seguros por constante tirados de RFCs ou de especificações de dispositivos.
- Safe spans que considerem fluxo de controle, suporte a constantes que mudam o layout e menor custo offline (2N recompilações, 18 minutos por constante), por exemplo reaproveitando a análise entre versões do kernel.
- Muitas constantes ajustadas ao mesmo tempo, incluindo a interação com knobs de sysctl existentes e com outras políticas de kernel baseadas em eBPF.
- Validação da afirmação de segurança por injeção de falhas ou verificações formais, e uma comparação direta com expor a constante no nível do código-fonte.
