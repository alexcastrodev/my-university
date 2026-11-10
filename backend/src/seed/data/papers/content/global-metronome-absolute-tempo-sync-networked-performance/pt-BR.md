---
title: "O Metrônomo Global: sincronização absoluta de andamento para performance musical em rede"
summary: Em vez de trocar pulsos de clock entre os músicos, cada local calcula o tempo atual a partir do próprio relógio de sistema bem sincronizado, e todos os metrônomos concordam sem conversar entre si.
researchArea: Computação musical
keywords: metrônomo global, sincronização de andamento, sincronização de relógios, gps, ntp, performance musical em rede
version: 1.0
updatedAt: 2026-11-10
---

## Resumo

Num futuro próximo, muitos computadores (incluindo dispositivos como smartphones) terão relógios de sistema sincronizados com alta precisão (menos de 1 ms de erro). Isso nos permitirá coordenar eventos entre dispositivos não conectados com um grau de precisão antes impossível. Em particular, uma sincronização de relógios tão alta significa que podemos usar esses relógios para sincronizar o andamento entre humanos ou sequenciadores com pouca ou nenhuma comunicação entre os dispositivos. Para viabilizar essa sincronização de andamento de baixo custo, propomos o Metrônomo Global, um método simples e computacionalmente barato para obter sincronização absoluta de andamento. Apresentamos resultados experimentais que demonstram a eficácia do Metrônomo Global e comparamos seu desempenho com a sincronização por MIDI clock, um método de sincronização comum. Por fim, apresentamos uma implementação de código aberto de um servidor de Metrônomo Global usando um Raspberry Pi conectado a GPS, que pode ser montado por menos de US$ 100.

## Visão geral

Tocar música rítmica pela Internet esbarra na latência. O áudio de um músico remoto chega atrasado, quem ouve espera para tocar junto com o que escuta, o outro lado faz o mesmo, e o conjunto desacelera. A literatura chama isso de tempo drag (arrasto de andamento), e com latência alta a execução rítmica desmorona.

Uma banda marcial tem um problema parecido, porque o som percorre mais ou menos 30 centímetros (um pé) por milissegundo. A solução dela é um regente, que é visto e não ouvido, e, numa banda grande, vários sub-regentes que seguem um regente principal. Este artigo do NIME 2016, de Reid Oda (Princeton) e Rebecca Fiebrink (Goldsmiths), aplica a mesma ideia à performance em rede. Cada local roda um metrônomo local, o sub-regente, e todo metrônomo local segue um regente principal virtual que "vem batendo no andamento desde a época Unix". Os músicos seguem o clique local, e esse clique está em tempo com todos os outros cliques, qualquer que seja o atraso de áudio entre os locais.

O porém é que isso só funciona se os relógios de sistema concordarem, e a segunda metade do artigo trata de conseguir relógios tão bons. A ideia foi retomada depois para conjuntos profissionais em rede, o que faz deste artigo a origem do termo "metrônomo global".

## Contribuição

- **O Metrônomo Global.** Um metrônomo no andamento f (em batidas por minuto) é tratado como um fasor que gira 2π radianos a cada período T = 60/f segundos. Dado um tempo Unix t em segundos, a fase do metrônomo global é a parte fracionária de t/T, vezes 2π: φ_global = 2π(t/T menos floor(t/T)). Há uma batida toda vez que essa fração volta a zero. Nenhuma mensagem é trocada: duas máquinas que usam a mesma fórmula, o mesmo f e relógios que concordam batem juntas, "automaticamente, sem nenhuma comunicação entre elas".
- **Deslocamentos locais e mudanças de andamento.** Um cliente pode somar um deslocamento de fase θ (0 < θ < 2π), o que dá φ_local = [2π(t/T menos floor(t/T)) + θ] mod 2π. Os músicos ficam sincronizados enquanto todos usarem o mesmo f e o mesmo θ. Mudanças de f ou θ podem ser planejadas antes ou enviadas entre os músicos, e o artigo deixa o mecanismo para quem desenvolve o sistema.
- **Fontes de relógio sem assimetria de rota.** Os autores defendem o GPS (precisão teórica de 14 nanossegundos, gratuito para qualquer um com receptor e vista do céu) e, no futuro, o LTE, cujo padrão exige relógios das estações-base dentro de 5 microssegundos. Nenhum dos dois sofre da assimetria de caminho que limita o NTP pela Internet.
- **O PIGMI.** Uma (Raspberry) Pi Global Metronome Implementation: um Raspberry Pi 2 com placa de expansão GPS, antena GPS ativa e adaptador wifi USB, por menos de US$ 100, de código aberto e com imagem Raspbian pronta. Ele pode clicar um pino GPIO como metrônomo audível, servir de servidor NTP para a sua LAN ou ser descoberto por hosts com LANdini e promovido a servidor de tempo mestre.
- **Medições** dos deslocamentos dos cliques em várias configurações, contra uma referência de MIDI clock.

Para um engenheiro de software, o mecanismo é o ponto central. Com MIDI clock, um mestre envia mensagens de tempo por um cabo e os escravos as seguem conforme chegam, então todo atraso ou jitter do enlace cai no tempo. Com o Metrônomo Global, a única coisa compartilhada é o andamento e o deslocamento, combinados antes, e a base de tempo comum vem da disciplina do relógio (GPS, ou NTP/PTP a partir de um servidor preciso próximo). A batida é uma função pura de (t, f, θ).

## Metodologia

Todo teste roda dois metrônomos audíveis a f = 120 bpm com θ = 0 durante 30 minutos. Os dois fluxos de áudio são gravados e, para cada clique, calcula-se o deslocamento em milissegundos em relação ao clique correspondente do outro fluxo. PIGMI-1 e PIGMI-2 são duas unidades específicas reutilizadas nos testes.

- **Configuração 1 (ambos com GPS).** Cada PIGMI tem o próprio receptor GPS e clica alternando um pino GPIO. Os dois pinos vão para um mixer cuja saída master é gravada. Testa dispositivos com acesso direto ao GPS.
- **Configuração 2 (GPS e NTP).** Os dois PIGMIs usam GPS. O PIGMI-1 clica via GPIO. Um MacBook Pro de 2011 com OS X Yosemite sincroniza o relógio de sistema via NTP com o PIGMI-2 e calcula os instantes dos cliques a partir desse relógio, com áudio gerado em Python. Testa NTP para um servidor de tempo preciso e de baixa latência.
- **Configuração 3 (GPS e LANdini).** Igual à anterior, mas o notebook se conecta ao PIGMI-2 pelo LANdini, o relógio de sistema não é sincronizado e os instantes dos cliques vêm do tempo de rede do LANdini, com áudio do SuperCollider.
- **Configuração 4 (GPS e sem sincronização).** O PIGMI-1 usa GPS e o PIGMI-2 roda no relógio interno livre, para mostrar a deriva.
- **MIDI clock.** Uma Korg Volca Beats e uma Korg Electribe ER-1, ligadas por cabo MIDI físico e sincronizadas por MIDI clock a partir de um host com Ableton Live, como referência do jitter de equipamentos MIDI comerciais.

Uma regressão linear é ajustada aos deslocamentos de cada configuração ao longo do tempo para detectar deriva.

## Resultados

Estes são os resultados relatados pelos autores.

- **GPS e NTP são muito precisos.** As configurações com GPS e NTP mostram picos ocasionais, em geral abaixo de 3 ms, e a grande maioria dos deslocamentos fica abaixo de 1 ms. As legendas das figuras põem o GPS em primeiro lugar, seguido de perto pelo NTP.
- **O LANdini fica no nível das baterias eletrônicas MIDI**, que são elas mesmas as piores entre as montagens sincronizadas: os dispositivos MIDI mostram uma distribuição bimodal dos deslocamentos e um desvio padrão cinco vezes maior que o das montagens com GPS e NTP. Mesmo assim soam sincronizados, o que os autores tomam como prova de que a sincronização do PIGMI é "excepcionalmente precisa".
- **Sem sincronização há deriva.** A configuração 4 tem deslocamento médio de cerca de menos 2 ms e é a única cuja regressão tem inclinação diferente de zero, 0,006 ms/min com p < 0,0001. Todas as outras configurações têm p > 0,33, ou seja, nenhuma deriva detectável.
- **Relógios livres são ruins.** Como motivação, dois computadores de teste dos autores derivam 0,7 ms por segundo, ou 42 ms depois de um minuto, o que é audível.
- **NTP pela Internet** é descrito como preciso na ordem de "dezenas ou centenas de milissegundos", principalmente porque o NTP padrão supõe caminhos simétricos, enquanto NTP numa LAN para um servidor disciplinado por GPS é extremamente preciso.

Os autores veem a abordagem como mais útil de imediato para gêneros de andamento estável, como Hip Hop e música eletrônica de pista, com o áudio transmitido por algo como o JackTrip, e para músicos de rock e jazz acostumados a tocar com click track.

## Análise crítica

A ideia é simples e correta, e essa é a sua força: ela transforma sincronização de andamento em sincronização de relógios, um problema resolvido quando há bom hardware. A avaliação, porém, é menor que as afirmações.

- **A distância é suposta, não testada.** As legendas dizem que os dispositivos "poderiam estar a centenas de milhas uns dos outros", mas todas as gravações vêm de dispositivos ligados a um único mixer. O argumento de que receptores GPS distantes sincronizam tão bem quanto vizinhos se apoia numa citação, não numa medição.
- **O caso da Internet pública não é medido.** O NTP só foi testado para um PIGMI na mesma LAN. O número de "dezenas ou centenas de milissegundos" para NTP pela Internet aparece sem medição. Para quem implementa, os próprios números do artigo apontam um caminho: manter a fonte de tempo perto (um servidor disciplinado por GPS na LAN de cada local, ou o tempo GPS ou LTE de um celular) e não depender de um servidor NTP público distante se a concordância abaixo de um milissegundo importar.
- **Amostra pequena.** Um andamento, 30 minutos por configuração, um notebook e um sistema operacional, e poucos pares de hardware. Os desvios padrão aparecem só numa figura, então o texto traz razões e limites, não uma tabela completa.
- **O resultado sem sincronização é sutil.** Uma inclinação de 0,006 ms/min somaria bem menos de 1 ms em 30 minutos, então a maior parte dos menos 2 ms é um deslocamento inicial, não deriva. O artigo não explica como o relógio livre do PIGMI-2 foi acertado no início, e o exemplo de 0,7 ms por segundo (de outras máquinas) é muito maior do que o PIGMI-2 mostra.
- **A latência de saída faz parte do problema.** A configuração 1 é o melhor caso: um pino GPIO comuta quase sem atraso. As configurações 2 e 3 mostram que um notebook ainda pode ser preciso, mas qualquer implementação precisa agendar o clique no instante calculado menos a latência de saída de áudio do dispositivo, algo que a fórmula em si não cobre.
- **As mudanças de andamento ficam em aberto.** Como a fase depende de t/T, mudar f num instante qualquer faz a fase saltar, a menos que θ seja recalculado na troca, e todos os músicos precisam trocar no mesmo instante absoluto. O artigo nomeia o problema e o deixa para os desenvolvedores.
- **Resolve o clique, não a escuta.** Cada músico fica na grade, mas o áudio remoto continua chegando atrasado. Tocar junto com um clique comum é diferente de reagir uns aos outros, o que o artigo reconhece ao apontar para gêneros de andamento estável.

## Pesquisas futuras

- Estudar performances reais, fisicamente distribuídas, com o Metrônomo Global e as interações humanas que surgem delas, como os autores planejam.
- Suportar mais métodos de sincronização local no PIGMI, como Ableton Link e MIDI clock, para alimentar equipamentos existentes.
- Tempo LTE em dispositivos móveis, que os autores veem como o que torna os celulares clientes naturais do Metrônomo Global.
- Para conjuntos que querem mudanças de andamento orgânicas: controles virtuais de andamento para um regente humano, rastreamento automático de batida ou rastreamento de regente aplicado a líderes musicais designados, com o Metrônomo Global como um dos componentes.
- Medições em distâncias realmente longas e sobre NTP ou PTP pela Internet, que o artigo defende mas não executa.
